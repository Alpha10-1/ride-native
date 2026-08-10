// Supabase Edge Function: paystack-charge-ride-card
//
// Called right after a ride is marked complete (from either the driver's
// or rider's device — whichever gets there first) when the ride's
// payment_method is 'card' and the rider already has a saved card on
// file from a previous ride or top-up. Charges that saved authorization
// directly via Paystack's charge_authorization endpoint — no checkout
// screen, no rider action needed. If there's no saved card, this returns
// a needs_checkout flag instead of an error, so the app knows to fall
// back to paystack-initialize-ride-checkout.
//
// Unlike paystack-initialize-ride-checkout, this gets a synchronous
// success/fail response from Paystack, so it updates ride_payments and
// rides.payment_status directly (mirroring paystack-charge-recurring) —
// it doesn't need to wait for the webhook, though the webhook handles
// the same event too and is idempotent if it arrives anyway.
//
// DEPLOY:
//   supabase functions deploy paystack-charge-ride-card
// SECRETS:
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("paystack-charge-ride-card: missing Authorization header");
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const rideId = body?.ride_id as string | undefined;
    if (!rideId) {
      return new Response(JSON.stringify({ error: "ride_id is required." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      console.error("paystack-charge-ride-card: auth.getUser failed", userError);
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const callerId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: ride, error: rideError } = await adminClient
      .from("rides")
      .select(
        "id, rider_id, driver_id, status, payment_method, payment_status, final_fare_cents, " +
        "card_reservation_status, card_reservation_reference, card_reservation_amount_cents"
      )
      .eq("id", rideId)
      .maybeSingle();

    if (rideError || !ride) {
      console.error("paystack-charge-ride-card: ride fetch failed", rideError);
      return new Response(JSON.stringify({ error: `Ride not found: ${rideError?.message ?? "no row"}` }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    // Either party on the ride can trigger settlement — the driver
    // completing the trip, or the rider viewing their receipt.
    if (callerId !== ride.rider_id && callerId !== ride.driver_id) {
      return new Response(JSON.stringify({ error: "Not authorized for this ride." }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    if (ride.status !== "completed") {
      return new Response(JSON.stringify({ error: "This ride hasn't been completed yet." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (ride.payment_method !== "card") {
      return new Response(JSON.stringify({ error: "This ride isn't set to pay by card." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (ride.payment_status === "paid") {
      return new Response(JSON.stringify({ ok: true, already_paid: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const amountCents = ride.final_fare_cents ?? 0;
    if (amountCents <= 0) {
      await adminClient.from("rides").update({ payment_status: "paid" }).eq("id", rideId);
      return new Response(JSON.stringify({ ok: true, amount_cents: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // If accept-time reserved a hold on the rider's card, capture that
    // instead of doing a brand-new charge. Paystack can only capture up
    // to the amount that was held, so if the final fare ended up higher
    // than the estimate that was reserved (e.g. a longer route, surge
    // that changed mid-trip), capture the full hold and charge the
    // shortfall as a normal follow-up charge_authorization.
    if (ride.card_reservation_status === "reserved" && ride.card_reservation_reference) {
      if (!PAYSTACK_SECRET_KEY) {
        console.error("paystack-charge-ride-card: PAYSTACK_SECRET_KEY is empty/unset");
        return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      const heldAmount = ride.card_reservation_amount_cents ?? amountCents;
      const captureAmount = Math.min(amountCents, heldAmount);
      const shortfall = amountCents - captureAmount;

      try {
        const captureRes = await fetch("https://api.paystack.co/preauthorization/capture", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reference: ride.card_reservation_reference,
            currency: "ZAR",
            amount: captureAmount,
          }),
        });
        const captureData: any = await captureRes.json();
        const captureStatus = captureData?.data?.status; // 'success' on success

        console.log(`paystack-charge-ride-card: capture ride=${rideId} response status=${captureRes.status} paystack_status=${captureStatus}`);

        if (captureRes.ok && captureData.status && captureStatus === "success") {
          await adminClient
            .from("ride_payments")
            .update({
              status: "success",
              paystack_transaction_id: captureData.data?.id != null ? String(captureData.data.id) : null,
              paid_at: new Date().toISOString(),
            })
            .eq("paystack_reference", ride.card_reservation_reference);
          await adminClient
            .from("rides")
            .update({ card_reservation_status: "captured" })
            .eq("id", rideId);

          if (shortfall > 0) {
            // Best-effort — the hold covered most of it; a failure here
            // still leaves the ride correctly marked paid for the
            // captured portion rather than blocking the rider/driver.
            const { data: card } = await adminClient
              .from("rider_cards")
              .select("paystack_authorization_code")
              .eq("rider_id", ride.rider_id)
              .eq("is_default", true)
              .maybeSingle();
            if (card?.paystack_authorization_code) {
              const { data: profile } = await adminClient
                .from("profiles")
                .select("email")
                .eq("id", ride.rider_id)
                .single();
              const email = profile?.email || `${ride.rider_id}@ridenative.internal`;
              const shortfallRef = `ridepay_${rideId}_shortfall_${Date.now()}`;
              await adminClient.from("ride_payments").insert({
                ride_id: rideId,
                rider_id: ride.rider_id,
                amount_cents: shortfall,
                currency: "ZAR",
                status: "pending",
                kind: "charge",
                paystack_reference: shortfallRef,
              });
              try {
                const shortfallRes = await fetch("https://api.paystack.co/transaction/charge_authorization", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    authorization_code: card.paystack_authorization_code,
                    email,
                    amount: shortfall,
                    currency: "ZAR",
                    reference: shortfallRef,
                    metadata: { ride_id: rideId, rider_id: ride.rider_id, purpose: "ride_card_shortfall" },
                  }),
                });
                const shortfallData: any = await shortfallRes.json();
                if (shortfallRes.ok && shortfallData.status && shortfallData?.data?.status === "success") {
                  await adminClient.from("ride_payments").update({
                    status: "success",
                    paystack_transaction_id: shortfallData.data?.id != null ? String(shortfallData.data.id) : null,
                    paid_at: new Date().toISOString(),
                  }).eq("paystack_reference", shortfallRef);
                } else {
                  await adminClient.from("ride_payments").update({
                    status: "failed",
                    failure_reason: shortfallData?.data?.gateway_response ?? shortfallData?.message ?? "Shortfall charge failed.",
                  }).eq("paystack_reference", shortfallRef);
                }
              } catch (shortfallErr) {
                console.error("paystack-charge-ride-card: shortfall charge failed", String(shortfallErr));
              }
            }
          }

          await adminClient.from("rides").update({ payment_status: "paid" }).eq("id", rideId);
          return new Response(JSON.stringify({ ok: true, amount_cents: amountCents, captured_via: "reservation" }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        const captureFailure = captureData?.data?.gateway_response ?? captureData?.message ?? "Capture failed.";
        await adminClient
          .from("ride_payments")
          .update({ status: "failed", failure_reason: captureFailure })
          .eq("paystack_reference", ride.card_reservation_reference);
        await adminClient.from("rides").update({ card_reservation_status: "failed" }).eq("id", rideId);
        // Fall through to a normal fresh charge attempt below, in case
        // the hold expired or was declined for some other reason.
      } catch (captureErr) {
        console.error("paystack-charge-ride-card: capture fetch failed", String(captureErr));
        // Fall through to the normal charge flow below.
      }
    }

    const { data: card, error: cardError } = await adminClient
      .from("rider_cards")
      .select("paystack_authorization_code")
      .eq("rider_id", ride.rider_id)
      .eq("is_default", true)
      .maybeSingle();

    if (cardError) {
      console.error("paystack-charge-ride-card: rider_cards lookup failed", cardError);
    }

    if (!card?.paystack_authorization_code) {
      // No saved card — the app should fall back to
      // paystack-initialize-ride-checkout for a fresh checkout instead.
      return new Response(JSON.stringify({ needs_checkout: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const { data: profile } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", ride.rider_id)
      .single();
    const email = profile?.email || `${ride.rider_id}@ridenative.internal`;

    const reference = `ridepay_${rideId}_${Date.now()}`;

    const { error: paymentInsertError } = await adminClient.from("ride_payments").insert({
      ride_id: rideId,
      rider_id: ride.rider_id,
      amount_cents: amountCents,
      currency: "ZAR",
      status: "pending",
      paystack_reference: reference,
    });
    if (paymentInsertError) {
      console.error("paystack-charge-ride-card: ride_payments insert failed", paymentInsertError);
      return new Response(JSON.stringify({ error: `Payment insert failed: ${paymentInsertError.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    await adminClient
      .from("rides")
      .update({ payment_status: "pending", payment_reference: reference })
      .eq("id", rideId);

    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-charge-ride-card: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    let chargeData: any;
    try {
      const res = await fetch("https://api.paystack.co/transaction/charge_authorization", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          authorization_code: card.paystack_authorization_code,
          email,
          amount: amountCents,
          currency: "ZAR",
          reference,
          metadata: {
            ride_id: rideId,
            rider_id: ride.rider_id,
            purpose: "ride_card_payment",
          },
        }),
      });
      chargeData = await res.json();

      const chargeStatus = chargeData?.data?.status; // 'success' | 'failed' | ...
      console.log(`paystack-charge-ride-card: ride=${rideId} response status=${res.status} paystack_status=${chargeStatus}`);

      if (res.ok && chargeData.status && chargeStatus === "success") {
        await adminClient
          .from("ride_payments")
          .update({
            status: "success",
            paystack_transaction_id: String(chargeData.data.id),
            paid_at: new Date().toISOString(),
          })
          .eq("paystack_reference", reference);

        await adminClient.from("rides").update({ payment_status: "paid" }).eq("id", rideId);

        return new Response(JSON.stringify({ ok: true, amount_cents: amountCents }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      const failureReason = chargeData?.data?.gateway_response ?? chargeData?.message ?? "Charge failed.";
      await adminClient
        .from("ride_payments")
        .update({ status: "failed", failure_reason: failureReason })
        .eq("paystack_reference", reference);
      await adminClient.from("rides").update({ payment_status: "failed" }).eq("id", rideId);

      return new Response(JSON.stringify({ ok: false, error: failureReason }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (fetchErr) {
      console.error("paystack-charge-ride-card: fetch to Paystack failed", String(fetchErr));
      await adminClient
        .from("ride_payments")
        .update({ status: "failed", failure_reason: String(fetchErr) })
        .eq("paystack_reference", reference);
      await adminClient.from("rides").update({ payment_status: "failed" }).eq("id", rideId);
      return new Response(JSON.stringify({ error: `Couldn't reach Paystack: ${String(fetchErr)}` }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
  } catch (err) {
    console.error("paystack-charge-ride-card: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});