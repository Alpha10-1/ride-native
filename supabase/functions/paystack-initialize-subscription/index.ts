// Supabase Edge Function: paystack-initialize-subscription
//
// Called from the app when a driver needs to pay to start (or restart)
// their monthly subscription — first-ever payment, or reactivating after
// 'blocked'/'canceled'. Returns a Paystack hosted checkout URL; the app
// opens it with expo-web-browser and then calls paystack-verify... no —
// verification actually happens via the paystack-webhook function below,
// not a client call, so a driver can't fake a successful payment by
// closing the browser early and claiming success.
//
// Amount charged is whatever driver_subscription_amount_cents() says for
// this driver's current billing_cycle_count — R120 for the first 3
// cycles, R150 after — so reactivating after a cancellation partway
// through the intro period still honours the remaining R120 cycles.
//
// DEPLOY:
//   supabase functions deploy paystack-initialize-subscription
// SECRETS:
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx   (or sk_live_ once ready)
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are already
// available to every Edge Function automatically.)

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("paystack-initialize-subscription: missing Authorization header");
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the calling driver from their own JWT — never trust a
    // driver_id passed in the request body.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      console.error("paystack-initialize-subscription: auth.getUser failed", userError);
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
    }
    const driverId = userData.user.id;
    console.log(`paystack-initialize-subscription: driverId=${driverId}`);

    const { data: profile, error: profileError } = await callerClient
      .from("profiles")
      .select("email, first_name, last_name, role")
      .eq("id", driverId)
      .single();

    if (profileError || !profile) {
      console.error("paystack-initialize-subscription: profile fetch failed", profileError);
      return new Response(JSON.stringify({ error: `Profile not found: ${profileError?.message ?? "no row"}` }), { status: 404 });
    }
    if (profile.role !== "driver") {
      console.error(`paystack-initialize-subscription: role check failed, role="${profile.role}"`);
      return new Response(JSON.stringify({ error: `Only drivers have a subscription (role was "${profile.role}").` }), { status: 403 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Existing row (if any) tells us the correct price tier to charge —
    // a driver reactivating at cycle 4 pays R150, not the intro price.
    const { data: existingSub, error: existingSubError } = await adminClient
      .from("driver_subscriptions")
      .select("billing_cycle_count")
      .eq("driver_id", driverId)
      .maybeSingle();
    if (existingSubError) {
      console.error("paystack-initialize-subscription: existingSub lookup failed", existingSubError);
      return new Response(JSON.stringify({ error: `driver_subscriptions lookup failed: ${existingSubError.message}` }), { status: 500 });
    }

    const cycleCount = existingSub?.billing_cycle_count ?? 0;

    const { data: amountData, error: amountError } = await adminClient.rpc(
      "driver_subscription_amount_cents",
      { cycle_count: cycleCount }
    );
    if (amountError) {
      console.error("paystack-initialize-subscription: amount RPC failed", amountError);
      return new Response(JSON.stringify({ error: `driver_subscription_amount_cents failed: ${amountError.message}` }), { status: 500 });
    }
    const amountCents = amountData as number;

    // Ensure a driver_subscriptions row exists so the payment row's FK
    // and later webhook upsert both have somewhere to land.
    const { error: upsertError } = await adminClient
      .from("driver_subscriptions")
      .upsert({ driver_id: driverId }, { onConflict: "driver_id", ignoreDuplicates: true });
    if (upsertError) {
      console.error("paystack-initialize-subscription: driver_subscriptions upsert failed", upsertError);
      return new Response(JSON.stringify({ error: `driver_subscriptions upsert failed: ${upsertError.message}` }), { status: 500 });
    }

    const reference = `sub_${driverId}_${Date.now()}`;
    const email = profile.email || `${driverId}@ridenative.internal`;

    const { error: paymentInsertError } = await adminClient.from("driver_subscription_payments").insert({
      driver_id: driverId,
      billing_cycle_number: cycleCount,
      amount_cents: amountCents,
      currency: "ZAR",
      status: "pending",
      paystack_reference: reference,
    });
    if (paymentInsertError) {
      console.error("paystack-initialize-subscription: payment row insert failed", paymentInsertError);
      return new Response(JSON.stringify({ error: `payment insert failed: ${paymentInsertError.message}` }), { status: 500 });
    }

    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-initialize-subscription: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500 });
    }

    console.log(`paystack-initialize-subscription: calling Paystack, amount=${amountCents}, email=${email}, ref=${reference}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000); // fail fast instead of hanging until the platform kills the function

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
            driver_id: driverId,
            billing_cycle_number: cycleCount,
            purpose: "driver_subscription",
          },
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      console.error("paystack-initialize-subscription: fetch to Paystack failed or timed out", String(fetchErr));
      return new Response(
        JSON.stringify({ error: `Couldn't reach Paystack: ${String(fetchErr)}` }),
        { status: 502 }
      );
    } finally {
      clearTimeout(timeout);
    }

    const paystackData = await paystackRes.json();
    if (!paystackRes.ok || !paystackData.status) {
      console.error("paystack-initialize-subscription: Paystack rejected the request", paystackRes.status, paystackData);
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
    console.error("paystack-initialize-subscription: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
