// Supabase Edge Function: paystack-reserve-ride-card
//
// Called right after accept_ride() succeeds on the driver's device, only
// when the ride's payment_method is 'card'. Places a hold for the agreed
// fare on the rider's saved card via Paystack's Preauthorization API
// (South Africa / ZAR only) — the card isn't actually charged yet, the
// funds are just set aside so the driver has some assurance the rider can
// pay before starting the trip.
//
// This is best-effort from the app's point of view: if the rider has no
// saved card, or the reservation fails for any reason, the ride is NOT
// blocked — it just proceeds without a hold, and payment happens the
// normal way at completion (paystack-charge-ride-card falls back to a
// fresh charge_authorization or checkout when there's no reservation).
//
// DEPLOY:
//   supabase functions deploy paystack-reserve-ride-card
// SECRETS (shared with the other paystack-* functions):
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("paystack-reserve-ride-card: missing Authorization header");
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
      console.error("paystack-reserve-ride-card: auth.getUser failed", userError);
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const callerId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: ride, error: rideError } = await adminClient
      .from("rides")
      .select(
        "id, rider_id, driver_id, status, payment_method, payment_status, " +
        "estimated_fare_cents, rider_proposed_fare_cents, final_fare_cents, " +
        "card_reservation_status"
      )
      .eq("id", rideId)
      .maybeSingle();

    if (rideError || !ride) {
      console.error("paystack-reserve-ride-card: ride fetch failed", rideError);
      return new Response(JSON.stringify({ error: `Ride not found: ${rideError?.message ?? "no row"}` }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    // Either party can trigger this (accept happens on the driver's
    // device, but allow the rider to retry too if it ever needs it).
    if (callerId !== ride.rider_id && callerId !== ride.driver_id) {
      return new Response(JSON.stringify({ error: "Not authorized for this ride." }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    if (ride.status === "completed" || ride.status === "cancelled") {
      return new Response(JSON.stringify({ error: "This ride has already ended." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (ride.payment_method !== "card") {
      // Not an error — this function is only meaningful for card rides.
      return new Response(JSON.stringify({ ok: true, skipped: "not_card" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Idempotent: already reserved/captured, or a reservation attempt is
    // already in flight — don't double up.
    if (["reserved", "captured", "pending"].includes(ride.card_reservation_status)) {
      return new Response(JSON.stringify({ ok: true, skipped: ride.card_reservation_status }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const amountCents = ride.final_fare_cents ?? ride.rider_proposed_fare_cents ?? ride.estimated_fare_cents ?? 0;
    if (amountCents <= 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_fare_yet" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const { data: card, error: cardError } = await adminClient
      .from("rider_cards")
      .select("paystack_authorization_code")
      .eq("rider_id", ride.rider_id)
      .eq("is_default", true)
      .maybeSingle();

    if (cardError) {
      console.error("paystack-reserve-ride-card: rider_cards lookup failed", cardError);
    }

    if (!card?.paystack_authorization_code) {
      // No saved card to place a hold on — not fatal, just nothing to do.
      // The ride still proceeds and pays normally at completion.
      return new Response(JSON.stringify({ ok: true, skipped: "no_saved_card" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-reserve-ride-card: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const { data: profile } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", ride.rider_id)
      .single();
    const email = profile?.email || `${ride.rider_id}@ridenative.internal`;

    const reference = `ridehold_${rideId}_${Date.now()}`;

    const { error: paymentInsertError } = await adminClient.from("ride_payments").insert({
      ride_id: rideId,
      rider_id: ride.rider_id,
      amount_cents: amountCents,
      currency: "ZAR",
      status: "pending",
      kind: "reservation",
      paystack_reference: reference,
    });
    if (paymentInsertError) {
      console.error("paystack-reserve-ride-card: ride_payments insert failed", paymentInsertError);
      return new Response(JSON.stringify({ error: `Reservation insert failed: ${paymentInsertError.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    await adminClient
      .from("rides")
      .update({
        card_reservation_status: "pending",
        card_reservation_reference: reference,
        card_reservation_amount_cents: amountCents,
      })
      .eq("id", rideId);

    try {
      const res = await fetch("https://api.paystack.co/preauthorization/reserve_authorization", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amountCents,
          currency: "ZAR",
          authorization_code: card.paystack_authorization_code,
          reference,
        }),
      });
      const resData: any = await res.json();
      const reserveStatus = resData?.data?.status; // 'authorized' on success

      console.log(`paystack-reserve-ride-card: ride=${rideId} response status=${res.status} paystack_status=${reserveStatus}`);

      if (res.ok && resData.status && reserveStatus === "authorized") {
        await adminClient
          .from("ride_payments")
          .update({
            status: "reserved",
            paystack_transaction_id: resData.data?.id != null ? String(resData.data.id) : null,
          })
          .eq("paystack_reference", reference);

        await adminClient
          .from("rides")
          .update({ card_reservation_status: "reserved", payment_status: "reserved" })
          .eq("id", rideId);

        return new Response(JSON.stringify({ ok: true, amount_cents: amountCents, reference }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      const failureReason = resData?.data?.gateway_response ?? resData?.message ?? "Reservation failed.";
      await adminClient
        .from("ride_payments")
        .update({ status: "failed", failure_reason: failureReason })
        .eq("paystack_reference", reference);
      await adminClient
        .from("rides")
        .update({ card_reservation_status: "failed" })
        .eq("id", rideId);

      // Still ok:true — a failed hold doesn't stop the ride, it just
      // means completion falls back to a normal charge attempt.
      return new Response(JSON.stringify({ ok: false, error: failureReason }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (fetchErr) {
      console.error("paystack-reserve-ride-card: fetch to Paystack failed", String(fetchErr));
      await adminClient
        .from("ride_payments")
        .update({ status: "failed", failure_reason: String(fetchErr) })
        .eq("paystack_reference", reference);
      await adminClient
        .from("rides")
        .update({ card_reservation_status: "failed" })
        .eq("id", rideId);
      return new Response(JSON.stringify({ ok: false, error: `Couldn't reach Paystack: ${String(fetchErr)}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  } catch (err) {
    console.error("paystack-reserve-ride-card: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});