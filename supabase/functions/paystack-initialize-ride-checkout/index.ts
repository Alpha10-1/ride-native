// Supabase Edge Function: paystack-initialize-ride-checkout
//
// Called from the rider's ride-complete screen when a completed ride is
// tagged payment_method='card' and the rider has no saved card yet (or
// their saved charge failed and they want to try a different card).
// Returns a Paystack hosted checkout URL for the exact fare amount; the
// app opens it with expo-web-browser. paystack-webhook marks the ride
// paid once Paystack confirms the charge, and also saves the card used
// so future rides can skip straight to paystack-charge-ride-card.
//
// DEPLOY:
//   supabase functions deploy paystack-initialize-ride-checkout
// SECRETS:
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("paystack-initialize-ride-checkout: missing Authorization header");
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), { status: 401 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), { status: 400 });
    }

    const rideId = body?.ride_id as string | undefined;
    if (!rideId) {
      return new Response(JSON.stringify({ error: "ride_id is required." }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      console.error("paystack-initialize-ride-checkout: auth.getUser failed", userError);
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
    }
    const riderId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: ride, error: rideError } = await adminClient
      .from("rides")
      .select("id, rider_id, status, payment_method, payment_status, final_fare_cents")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError || !ride) {
      console.error("paystack-initialize-ride-checkout: ride fetch failed", rideError);
      return new Response(JSON.stringify({ error: `Ride not found: ${rideError?.message ?? "no row"}` }), { status: 404 });
    }
    if (ride.rider_id !== riderId) {
      return new Response(JSON.stringify({ error: "Not authorized for this ride." }), { status: 403 });
    }
    if (ride.status !== "completed") {
      return new Response(JSON.stringify({ error: "This ride hasn't been completed yet." }), { status: 400 });
    }
    if (ride.payment_status === "paid") {
      return new Response(JSON.stringify({ error: "This ride is already paid." }), { status: 400 });
    }

    const amountCents = ride.final_fare_cents ?? 0;
    if (amountCents <= 0) {
      return new Response(JSON.stringify({ error: "This ride has no fare to charge." }), { status: 400 });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", riderId)
      .single();
    if (profileError) {
      console.error("paystack-initialize-ride-checkout: profile fetch failed", profileError);
    }
    const email = profile?.email || `${riderId}@ridenative.internal`;

    const reference = `ridepay_${rideId}_${Date.now()}`;

    const { error: paymentInsertError } = await adminClient.from("ride_payments").insert({
      ride_id: rideId,
      rider_id: riderId,
      amount_cents: amountCents,
      currency: "ZAR",
      status: "pending",
      paystack_reference: reference,
    });
    if (paymentInsertError) {
      console.error("paystack-initialize-ride-checkout: ride_payments insert failed", paymentInsertError);
      return new Response(JSON.stringify({ error: `Payment insert failed: ${paymentInsertError.message}` }), { status: 500 });
    }

    await adminClient
      .from("rides")
      .update({ payment_status: "pending", payment_reference: reference })
      .eq("id", rideId);

    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-initialize-ride-checkout: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    let paystackRes: Response;
    try {
      paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amountCents,
          currency: "ZAR",
          reference,
          channels: ["card"],
          metadata: {
            ride_id: rideId,
            rider_id: riderId,
            purpose: "ride_card_payment",
          },
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      console.error("paystack-initialize-ride-checkout: fetch to Paystack failed or timed out", String(fetchErr));
      return new Response(JSON.stringify({ error: `Couldn't reach Paystack: ${String(fetchErr)}` }), { status: 502 });
    } finally {
      clearTimeout(timeout);
    }

    const paystackData = await paystackRes.json();
    if (!paystackRes.ok || !paystackData.status) {
      console.error("paystack-initialize-ride-checkout: Paystack rejected the request", paystackRes.status, paystackData);
      return new Response(
        JSON.stringify({ error: paystackData.message ?? `Paystack returned HTTP ${paystackRes.status}` }),
        { status: 502 }
      );
    }

    return new Response(
      JSON.stringify({
        authorization_url: paystackData.data.authorization_url,
        reference,
        amount_cents: amountCents,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("paystack-initialize-ride-checkout: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
