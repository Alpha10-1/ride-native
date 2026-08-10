// Supabase Edge Function: paystack-charge-recurring
//
// Run on a daily schedule (see the bottom of
// supabase/migrations/20260730120000_driver_subscriptions.sql for cron
// setup). Does two jobs in one pass, both purely automatic — no driver
// action needed for a normal month:
//
//   1. BILLING: any 'active' subscription whose current_period_end has
//      passed gets charged via Paystack's charge_authorization endpoint,
//      reusing the card saved from checkout. R120 for the first 3
//      cycles, R150 after (driver_subscription_amount_cents). Success
//      renews the period and clears any past-due state; failure moves
//      the subscription to 'past_due' and starts the grace period.
//
//   2. RETRIES + ENFORCEMENT: any 'past_due' subscription gets a retry
//      charge too (covers "card temporarily declined, salary lands two
//      days later" type failures). If the grace period has expired
//      without a successful charge, the driver is blocked — this only
//      flips driver_subscriptions.status; it deliberately does NOT touch
//      whatever table tracks live online/offline presence (unknown from
//      this codebase), since go_online_checked() in the migration
//      already stops a blocked driver from going online going forward,
//      and the app polls get_my_subscription_gate() while online to
//      catch an already-online driver being blocked mid-shift.
//
// DEPLOY:
//   supabase functions deploy paystack-charge-recurring --no-verify-jwt
// SECRETS:
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
//   supabase secrets set CRON_SECRET=<any long random string>
//   supabase secrets set FUNCTION_SECRET=<same value already used by send-push, for push notifications>

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

function amountForCycle(cycleCount: number): number {
  return cycleCount < 3 ? 12000 : 15000;
}

async function notifyDriver(adminClient: any, driverId: string, title: string, body: string) {
  // Best-effort push via the existing send-push function + profiles.push_token
  // column, mirroring how push tokens are stored elsewhere in this app
  // (see src/lib/pushNotifications.ts savePushToken). Never let a
  // notification failure block billing logic.
  try {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("push_token, active_mode")
      .eq("id", driverId)
      .maybeSingle();

    // Dual-role accounts can switch between rider and driver mode
    // (see 20260803120000_dual_role_driver_apply.sql). Someone currently
    // using the app as a rider shouldn't get driver-side pushes like
    // "Payment failed" / subscription reminders — those only make sense
    // to someone actively driving. Billing itself still runs regardless
    // of active_mode; this only silences the notification.
    if (profile?.active_mode && profile.active_mode !== "driver") return;

    const token = profile?.push_token;
    if (!token) return;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const functionSecret = Deno.env.get("FUNCTION_SECRET");
    if (!functionSecret) return;

    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${functionSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tokens: [token], title, body, data: { type: "subscription" } }),
    });
  } catch {
    // best-effort, ignore
  }
}

Deno.serve(async (req: Request) => {
  console.log("paystack-charge-recurring: invoked");
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    console.error("paystack-charge-recurring: unauthorized (Authorization header didn't match CRON_SECRET)");
    return new Response("Unauthorized", { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const nowIso = new Date().toISOString();
  const results = { charged: 0, failed: 0, blocked: 0, errors: [] as string[] };

  // --- 1. Due charges: active subscriptions past their period end -----
  const { data: dueSubs, error: dueError } = await adminClient
    .from("driver_subscriptions")
    .select("*")
    .eq("status", "active")
    .lte("current_period_end", nowIso);

  // --- 2. Past-due subscriptions: retry, and enforce grace expiry -----
  const { data: pastDueSubs, error: pastDueError } = await adminClient
    .from("driver_subscriptions")
    .select("*")
    .eq("status", "past_due");

  if (dueError) results.errors.push(dueError.message);
  if (pastDueError) results.errors.push(pastDueError.message);
  if (dueError) console.error("paystack-charge-recurring: dueSubs query failed", dueError);
  if (pastDueError) console.error("paystack-charge-recurring: pastDueSubs query failed", pastDueError);

  const toCharge = [...(dueSubs ?? []), ...(pastDueSubs ?? [])];
  console.log(`paystack-charge-recurring: found ${dueSubs?.length ?? 0} due + ${pastDueSubs?.length ?? 0} past_due = ${toCharge.length} to process`);

  for (const sub of toCharge) {
    if (!sub.paystack_authorization_code) {
      // No card on file at all (shouldn't normally happen for a sub that
      // reached 'active' or 'past_due') — treat like a failed charge so
      // grace-period logic still applies instead of silently skipping.
      await handleFailedCharge(adminClient, sub, "No card on file.", results);
      continue;
    }

    const amountCents = amountForCycle(sub.billing_cycle_count);
    const reference = `sub_${sub.driver_id}_${Date.now()}`;

    await adminClient.from("driver_subscription_payments").insert({
      driver_id: sub.driver_id,
      billing_cycle_number: sub.billing_cycle_count,
      amount_cents: amountCents,
      currency: "ZAR",
      status: "pending",
      paystack_reference: reference,
    });

    try {
      const res = await fetch("https://api.paystack.co/transaction/charge_authorization", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          authorization_code: sub.paystack_authorization_code,
          email: `${sub.driver_id}@ridenative.internal`,
          amount: amountCents,
          currency: "ZAR",
          reference,
          metadata: {
            driver_id: sub.driver_id,
            billing_cycle_number: sub.billing_cycle_count,
            purpose: "driver_subscription",
          },
        }),
      });
      const data = await res.json();
      const chargeStatus = data?.data?.status; // 'success' | 'failed' | ...
      console.log(`paystack-charge-recurring: driver=${sub.driver_id} charge response status=${res.status} paystack_status=${chargeStatus}`);

      if (res.ok && data.status && chargeStatus === "success") {
        const periodStart = new Date();
        const periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await adminClient
          .from("driver_subscription_payments")
          .update({
            status: "success",
            paystack_transaction_id: String(data.data.id),
            paid_at: new Date().toISOString(),
          })
          .eq("paystack_reference", reference);

        await adminClient
          .from("driver_subscriptions")
          .update({
            status: "active",
            billing_cycle_count: sub.billing_cycle_count + 1,
            current_period_start: periodStart.toISOString(),
            current_period_end: periodEnd.toISOString(),
            grace_period_ends_at: null,
          })
          .eq("driver_id", sub.driver_id);

        results.charged++;
        await notifyDriver(
          adminClient,
          sub.driver_id,
          "Subscription renewed",
          `We charged R${(amountCents / 100).toFixed(2)} for this month's driver subscription.`
        );
      } else {
        await handleFailedCharge(
          adminClient,
          sub,
          data?.data?.gateway_response ?? data?.message ?? "Charge failed.",
          results,
          reference
        );
      }
    } catch (err) {
      await handleFailedCharge(adminClient, sub, String(err), results, reference);
    }
  }

  // --- 3. Enforce: past_due subscriptions whose grace period expired --
  const { data: expiredGrace } = await adminClient
    .from("driver_subscriptions")
    .select("driver_id")
    .eq("status", "past_due")
    .lt("grace_period_ends_at", nowIso);

  for (const sub of expiredGrace ?? []) {
    await adminClient
      .from("driver_subscriptions")
      .update({ status: "blocked" })
      .eq("driver_id", sub.driver_id);
    results.blocked++;
    await notifyDriver(
      adminClient,
      sub.driver_id,
      "Account blocked",
      "Your driver subscription payment didn't go through in time, so you can't go online until you update your card."
    );
  }

  console.log("paystack-charge-recurring: done", JSON.stringify(results));
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function handleFailedCharge(
  adminClient: any,
  sub: any,
  reason: string,
  results: { failed: number; errors: string[] },
  reference?: string
) {
  if (reference) {
    await adminClient
      .from("driver_subscription_payments")
      .update({ status: "failed", failure_reason: reason })
      .eq("paystack_reference", reference);
  }

  // Only (re)start the grace period the first time a subscription goes
  // past due — a retry that fails again during an already-running grace
  // period shouldn't push the deadline back out.
  const graceDays = sub.grace_period_days ?? 5;
  const alreadyPastDue = sub.status === "past_due" && sub.grace_period_ends_at;

  const update: Record<string, unknown> = { status: "past_due" };
  if (!alreadyPastDue) {
    const graceEnd = new Date();
    graceEnd.setDate(graceEnd.getDate() + graceDays);
    update.grace_period_ends_at = graceEnd.toISOString();
  }

  await adminClient.from("driver_subscriptions").update(update).eq("driver_id", sub.driver_id);
  results.failed++;

  if (!alreadyPastDue) {
    await notifyDriver(
      adminClient,
      sub.driver_id,
      "Subscription payment failed",
      `We couldn't charge your card. You have ${graceDays} days to update it before you're blocked from going online.`
    );
  }
}