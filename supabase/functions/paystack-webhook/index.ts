// Supabase Edge Function: paystack-webhook
//
// Paystack calls this directly (no Supabase auth involved) whenever a
// payment event happens — most importantly charge.success, for the
// driver's first checkout (paystack-initialize-subscription) and every
// automatic recurring charge (paystack-charge-recurring), as well as the
// rider-side flows added later: wallet top-ups
// (paystack-initialize-topup) and card ride payments made via a fresh
// checkout (paystack-initialize-ride-checkout — ride payments charged
// via a saved card go through paystack-charge-ride-card instead, which
// gets a synchronous response and doesn't strictly need this webhook,
// though it's idempotent if it arrives anyway). This is the single
// source of truth that actually activates/credits/settles any of these;
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
//   https://<project-ref>.supabase.co/functions/v1/paystack-webhook

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
      const purpose = data.metadata?.purpose as string | undefined;

      if (purpose === "wallet_topup") {
        return await handleWalletTopupSuccess(adminClient, data);
      }
      if (purpose === "ride_card_payment") {
        return await handleRideCardPaymentSuccess(adminClient, data);
      }
      if (purpose === "card_verification") {
        return await handleCardVerificationSuccess(adminClient, data);
      }

      const reference = data.reference as string;
      const driverId = data.metadata?.driver_id as string | undefined;

      // Only handle payments this system created (driver_subscription
      // purpose) — ignore anything else that might hit the same webhook
      // URL if it's ever reused for other Paystack products later.
      if (!driverId || purpose !== "driver_subscription") {
        return new Response(JSON.stringify({ skipped: "not a recognized payment purpose" }), { status: 200 });
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

    if (event.event === "preauthorization.reserve.success") {
      // Ride fund reservations (purpose "ride_card_reservation") get
      // their synchronous response handled directly in
      // paystack-reserve-ride-card and don't need this webhook — ignore.
      // (Card verification used to be handled here too, but now runs
      // through a plain charge — see handleCardVerificationSuccess.)
      return new Response(JSON.stringify({ ok: true, ignored: "not a recognized preauthorization purpose" }), { status: 200 });
    }

    if (event.event === "preauthorization.reserve.failed") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (event.event === "charge.failed") {
      const data = event.data;
      const reference = data.reference as string;
      const purpose = data.metadata?.purpose as string | undefined;
      const reason = data.gateway_response ?? "Payment failed.";

      if (purpose === "wallet_topup") {
        await adminClient
          .from("wallet_topup_payments")
          .update({ status: "failed", failure_reason: reason })
          .eq("paystack_reference", reference)
          .eq("status", "pending");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (purpose === "ride_card_payment") {
        await adminClient
          .from("ride_payments")
          .update({ status: "failed", failure_reason: reason })
          .eq("paystack_reference", reference)
          .eq("status", "pending");
        const rideId = data.metadata?.ride_id as string | undefined;
        if (rideId) {
          await adminClient
            .from("rides")
            .update({ payment_status: "failed" })
            .eq("id", rideId)
            .eq("payment_reference", reference);
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (purpose === "card_verification") {
        await adminClient
          .from("rider_card_verifications")
          .update({ status: "failed", failure_reason: reason })
          .eq("paystack_reference", reference)
          .eq("status", "pending");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      await adminClient
        .from("driver_subscription_payments")
        .update({ status: "failed", failure_reason: reason })
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

// Saves/promotes a card as the rider's default for one-tap future charges,
// but only if Paystack marked the authorization reusable — a non-reusable
// instrument (e.g. certain digital-wallet channels) can't be charged again
// later, so saving it would just produce a card that silently fails at
// charge time. Shared by every flow that can produce a fresh card
// authorization: ride checkout payments, wallet top-ups, and card
// verification.
async function saveRiderCardIfReusable(adminClient: any, riderId: string, authorization: any): Promise<void> {
  if (!authorization?.authorization_code || !authorization?.reusable) return;

  // Only one default card per rider — unset any previous default before
  // inserting/promoting this one, so paystack-charge-ride-card's
  // "is_default = true" lookup stays unambiguous.
  await adminClient.from("rider_cards").update({ is_default: false }).eq("rider_id", riderId);

  await adminClient.from("rider_cards").upsert(
    {
      rider_id: riderId,
      paystack_authorization_code: authorization.authorization_code,
      card_last4: authorization.last4 ?? null,
      card_brand: authorization.card_type ?? authorization.brand ?? null,
      card_exp_month: authorization.exp_month ?? null,
      card_exp_year: authorization.exp_year ?? null,
      is_default: true,
    },
    { onConflict: "rider_id,paystack_authorization_code" }
  );
}

// Credits a rider's wallet after a real-money top-up succeeds. Uses the
// credit_wallet_topup() RPC (service-role only) so the balance update and
// the wallet_transactions row happen atomically under a row lock, instead
// of two separate admin-client calls racing against a second concurrent
// top-up for the same rider.
async function handleWalletTopupSuccess(adminClient: any, data: any): Promise<Response> {
  const reference = data.reference as string;
  const riderId = data.metadata?.rider_id as string | undefined;
  if (!riderId) {
    return new Response(JSON.stringify({ skipped: "wallet_topup event missing rider_id" }), { status: 200 });
  }

  const { data: paymentRow, error: fetchError } = await adminClient
    .from("wallet_topup_payments")
    .select("*")
    .eq("paystack_reference", reference)
    .maybeSingle();

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  // Idempotency: Paystack can and does retry webhook delivery.
  if (paymentRow?.status === "success") {
    return new Response(JSON.stringify({ ok: true, already_processed: true }), { status: 200 });
  }

  const amountCents = paymentRow?.amount_cents ?? data.amount;

  const { error: creditError } = await adminClient.rpc("credit_wallet_topup", {
    rider_id_in: riderId,
    amount_cents_in: amountCents,
    description_in: "Wallet top-up",
  });
  if (creditError) {
    console.error("paystack-webhook: credit_wallet_topup failed", creditError);
    return new Response(JSON.stringify({ error: creditError.message }), { status: 500 });
  }

  await adminClient
    .from("wallet_topup_payments")
    .update({
      status: "success",
      paystack_transaction_id: String(data.id),
      paid_at: new Date().toISOString(),
    })
    .eq("paystack_reference", reference);

  // Bug fix: this branch previously never saved the card at all, even
  // though a top-up is a real card charge same as any other — a rider
  // topping up with a new card had no way to end up with it saved for
  // ride payments later.
  await saveRiderCardIfReusable(adminClient, riderId, data.authorization ?? {});

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// Confirms a card-verification charge (paystack-initialize-card-verification)
// succeeded: saves the card, then refunds the R10 so the rider isn't
// actually out any money for just adding a card. Unlike the old
// preauthorization hold-release, this is a genuine refund of a genuine
// charge — Paystack can take up to 10 business days to actually return
// the funds, even though the card itself is saved and usable right away
// (see the comment in paystack-initialize-card-verification for why this
// approach replaced the Preauthorization one).
async function handleCardVerificationSuccess(adminClient: any, data: any): Promise<Response> {
  const reference = data.reference as string;
  const riderId = data.metadata?.rider_id as string | undefined;
  if (!riderId) {
    return new Response(JSON.stringify({ skipped: "card_verification event missing rider_id" }), { status: 200 });
  }

  const { data: verificationRow, error: fetchError } = await adminClient
    .from("rider_card_verifications")
    .select("*")
    .eq("paystack_reference", reference)
    .maybeSingle();

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }
  // Idempotency: Paystack can and does retry webhook delivery.
  if (verificationRow?.status === "success" || verificationRow?.status === "refunded") {
    return new Response(JSON.stringify({ ok: true, already_processed: true }), { status: 200 });
  }

  await adminClient
    .from("rider_card_verifications")
    .update({
      status: "success",
      paystack_transaction_id: data.id != null ? String(data.id) : null,
      verified_at: new Date().toISOString(),
    })
    .eq("paystack_reference", reference);

  await saveRiderCardIfReusable(adminClient, riderId, data.authorization ?? {});

  // Best-effort: the card is already saved either way, which is what
  // actually matters for the rider to be able to use it — if the refund
  // request itself fails here, it's still visible via Paystack's
  // dashboard/List Refunds for manual follow-up, so this doesn't retry
  // in a loop that could double-refund on a delayed webhook redelivery.
  try {
    const res = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transaction: reference }),
    });
    if (res.ok) {
      await adminClient
        .from("rider_card_verifications")
        .update({ status: "refunded" })
        .eq("paystack_reference", reference);
    } else {
      console.error("paystack-webhook: card verification refund did not confirm", await res.text());
    }
  } catch (refundErr) {
    console.error("paystack-webhook: card verification refund fetch failed", String(refundErr));
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}



// Marks a ride paid after a rider completes a fresh Paystack checkout for
// the fare (paystack-initialize-ride-checkout — used when they had no
// saved card yet). Also saves the card as their new default for future
// one-tap ride charges, mirroring how driver_subscriptions saves a card
// from checkout for recurring billing.
async function handleRideCardPaymentSuccess(adminClient: any, data: any): Promise<Response> {
  const reference = data.reference as string;
  const rideId = data.metadata?.ride_id as string | undefined;
  const riderId = data.metadata?.rider_id as string | undefined;
  if (!rideId || !riderId) {
    return new Response(JSON.stringify({ skipped: "ride_card_payment event missing ride_id/rider_id" }), { status: 200 });
  }

  const { data: paymentRow, error: fetchError } = await adminClient
    .from("ride_payments")
    .select("*")
    .eq("paystack_reference", reference)
    .maybeSingle();

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  if (paymentRow?.status === "success") {
    return new Response(JSON.stringify({ ok: true, already_processed: true }), { status: 200 });
  }

  await adminClient
    .from("ride_payments")
    .update({
      status: "success",
      paystack_transaction_id: String(data.id),
      paid_at: new Date().toISOString(),
    })
    .eq("paystack_reference", reference);

  await adminClient
    .from("rides")
    .update({ payment_status: "paid" })
    .eq("id", rideId)
    .eq("payment_reference", reference);

  const authorization = data.authorization ?? {};
  await saveRiderCardIfReusable(adminClient, riderId, authorization);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}