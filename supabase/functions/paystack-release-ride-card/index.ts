// Supabase Edge Function: paystack-release-ride-card
//
// Called right after cancel_ride() succeeds, only when the ride has an
// active card_reservation_status of 'reserved' — releases the Paystack
// preauthorization hold so the funds go back to the rider immediately
// instead of sitting tied up until the hold's expiry window elapses.
//
// Best-effort: cancellation itself is never blocked or reversed by a
// failure here. If the release call fails, the hold still auto-expires
// on Paystack's side (default 5 days, action=release), so nothing is
// permanently stuck — this just makes the common case fast.
//
// DEPLOY:
//   supabase functions deploy paystack-release-ride-card
// SECRETS (shared with the other paystack-* functions):
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
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
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const callerId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: ride, error: rideError } = await adminClient
      .from("rides")
      .select("id, rider_id, driver_id, card_reservation_status, card_reservation_reference")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError || !ride) {
      return new Response(JSON.stringify({ error: `Ride not found: ${rideError?.message ?? "no row"}` }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (callerId !== ride.rider_id && callerId !== ride.driver_id) {
      return new Response(JSON.stringify({ error: "Not authorized for this ride." }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    if (ride.card_reservation_status !== "reserved" || !ride.card_reservation_reference) {
      // Nothing to release — fine, not an error.
      return new Response(JSON.stringify({ ok: true, skipped: "no_active_reservation" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-release-ride-card: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    try {
      const res = await fetch("https://api.paystack.co/preauthorization/release", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reference: ride.card_reservation_reference }),
      });
      const resData: any = await res.json();
      console.log(`paystack-release-ride-card: ride=${rideId} response status=${res.status} ok=${resData?.status}`);

      if (res.ok && resData?.status) {
        await adminClient
          .from("ride_payments")
          .update({ status: "released" })
          .eq("paystack_reference", ride.card_reservation_reference);
        await adminClient
          .from("rides")
          .update({ card_reservation_status: "released", payment_status: "unpaid" })
          .eq("id", rideId);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      console.error("paystack-release-ride-card: Paystack release did not confirm success", resData);
      return new Response(JSON.stringify({ ok: false, error: resData?.message ?? "Release did not confirm." }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (fetchErr) {
      console.error("paystack-release-ride-card: fetch to Paystack failed", String(fetchErr));
      return new Response(JSON.stringify({ ok: false, error: `Couldn't reach Paystack: ${String(fetchErr)}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  } catch (err) {
    console.error("paystack-release-ride-card: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});