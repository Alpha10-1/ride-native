// Supabase Edge Function: paystack-webhook
//
// Paystack calls this directly (no Supabase auth involved) whenever a
// payment event happens — most importantly charge.success, for both the
// driver's first checkout (paystack-initialize-subscription) and every
// automatic recurring charge (paystack-charge-recurring). This is the
// single source of truth that actually activates/renews a subscription;
// the client never gets to claim "I paid" on its own.
//
// Security: Paystack signs every webhook request with an HMAC-SHA512 of
// the raw body, using your secret key, in the x-paystack-signature
// header. Requests that don't match are rejected outright.
//
// DEPLOY:
//   supabase functions deploy paystack-webhook --no-verify-jwt
// (--no-verify-jwt is required — Paystack can't send a Supabase JWT, and
// the HMAC signature check below is what protects this endpoint instead.)
// SECRETS:
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
// THEN, in the Paystack Dashboard → Settings → API Keys & Webhooks, set
// the webhook URL to:
//   https://<project-ref>.functions.supabase.co/paystack-webhook

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === signature;
}

Deno.serve(async (req: Request) => {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    const valid = await verifySignature(rawBody, signature);
    if (!valid) {
      return new Response(JSON.stringify({ error: "Invalid signature." }), { status: 401 });
    }

    const event = JSON.parse(rawBody);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (event.event === "charge.success") {
      const data = event.data;
      const reference = data.reference as string;
      const driverId = data.metadata?.driver_id as string | undefined;

      // Only handle payments this system created (driver_subscription
      // purpose) — ignore anything else that might hit the same webhook
      // URL if it's ever reused for other Paystack products later.
      if (!driverId || data.metadata?.purpose !== "driver_subscription") {
        return new Response(JSON.stringify({ skipped: "not a subscription payment" }), { status: 200 });
      }

      const { data: paymentRow, error: paymentFetchError } = await adminClient
        .from("driver_subscription_payments")
        .select("*")
        .eq("paystack_reference", reference)
        .maybeSingle();

      if (paymentFetchError) {
        return new Response(JSON.stringify({ error: paymentFetchError.message }), { status: 500 });
      }

      // Idempotency: Paystack can and does retry webhook delivery. If this
      // reference is already marked success, don't double-count the
      // billing cycle or push the period forward twice.
      if (paymentRow?.status === "success") {
        return new Response(JSON.stringify({ ok: true, already_processed: true }), { status: 200 });
      }

      await adminClient
        .from("driver_subscription_payments")
        .update({
          status: "success",
          paystack_transaction_id: String(data.id),
          paid_at: new Date().toISOString(),
        })
        .eq("paystack_reference", reference);

      const { data: existingSub } = await adminClient
        .from("driver_subscriptions")
        .select("billing_cycle_count")
        .eq("driver_id", driverId)
        .maybeSingle();

      const nextCycleCount = (existingSub?.billing_cycle_count ?? 0) + 1;
      const periodStart = new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const authorization = data.authorization ?? {};

      await adminClient.from("driver_subscriptions").upsert(
        {
          driver_id: driverId,
          status: "active",
          paystack_customer_code: data.customer?.customer_code ?? null,
          paystack_authorization_code: authorization.authorization_code ?? null,
          card_last4: authorization.last4 ?? null,
          card_brand: authorization.card_type ?? authorization.brand ?? null,
          billing_cycle_count: nextCycleCount,
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
          grace_period_ends_at: null,
          canceled_at: null,
        },
        { onConflict: "driver_id" }
      );

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (event.event === "charge.failed") {
      const data = event.data;
      const reference = data.reference as string;
      await adminClient
        .from("driver_subscription_payments")
        .update({ status: "failed", failure_reason: data.gateway_response ?? "Payment failed." })
        .eq("paystack_reference", reference)
        .eq("status", "pending");
      // Subscription status transitions for failed *recurring* charges are
      // handled directly in paystack-charge-recurring (it gets a
      // synchronous response from Paystack and doesn't need to wait for
      // this webhook). This branch just keeps the payment row accurate
      // for failures during the initial checkout flow too.
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Any other event type — acknowledge and ignore.
    return new Response(JSON.stringify({ ok: true, ignored: event.event }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
