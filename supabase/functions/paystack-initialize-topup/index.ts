// Supabase Edge Function: paystack-initialize-topup
//
// Called from the rider's wallet screen when they want to add real money
// to their wallet. Returns a Paystack hosted checkout URL; the app opens
// it with expo-web-browser. Activation (crediting the wallet) happens
// server-side via paystack-webhook once Paystack confirms the charge —
// the client never gets to claim "I paid" on its own, same as the driver
// subscription flow this mirrors.
//
// DEPLOY:
//   supabase functions deploy paystack-initialize-topup
// SECRETS:
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx   (or sk_live_ once ready)

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();
const MIN_TOPUP_CENTS = 1000; // R10
const MAX_TOPUP_CENTS = 500000; // R5,000

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("paystack-initialize-topup: missing Authorization header");
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), { status: 401 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), { status: 400 });
    }

    const amountCents = Number(body?.amount_cents);
    if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
      return new Response(JSON.stringify({ error: "amount_cents must be an integer." }), { status: 400 });
    }
    if (amountCents < MIN_TOPUP_CENTS || amountCents > MAX_TOPUP_CENTS) {
      return new Response(
        JSON.stringify({ error: `amount_cents must be between ${MIN_TOPUP_CENTS} and ${MAX_TOPUP_CENTS}.` }),
        { status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the calling rider from their own JWT — never trust a
    // rider_id passed in the request body.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      console.error("paystack-initialize-topup: auth.getUser failed", userError);
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
    }
    const riderId = userData.user.id;
    console.log(`paystack-initialize-topup: riderId=${riderId}, amountCents=${amountCents}`);

    const { data: profile, error: profileError } = await callerClient
      .from("profiles")
      .select("email, role")
      .eq("id", riderId)
      .single();

    if (profileError || !profile) {
      console.error("paystack-initialize-topup: profile fetch failed", profileError);
      return new Response(JSON.stringify({ error: `Profile not found: ${profileError?.message ?? "no row"}` }), { status: 404 });
    }
    if (profile.role !== "rider") {
      console.error(`paystack-initialize-topup: role check failed, role="${profile.role}"`);
      return new Response(JSON.stringify({ error: "Only riders can top up a wallet." }), { status: 403 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const reference = `topup_${riderId}_${Date.now()}`;
    const email = profile.email || `${riderId}@ridenative.internal`;

    const { error: insertError } = await adminClient.from("wallet_topup_payments").insert({
      rider_id: riderId,
      amount_cents: amountCents,
      currency: "ZAR",
      status: "pending",
      paystack_reference: reference,
    });
    if (insertError) {
      console.error("paystack-initialize-topup: wallet_topup_payments insert failed", insertError);
      return new Response(JSON.stringify({ error: `Top-up insert failed: ${insertError.message}` }), { status: 500 });
    }

    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-initialize-topup: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500 });
    }

    console.log(`paystack-initialize-topup: calling Paystack, amount=${amountCents}, email=${email}, ref=${reference}`);

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
            rider_id: riderId,
            purpose: "wallet_topup",
          },
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      console.error("paystack-initialize-topup: fetch to Paystack failed or timed out", String(fetchErr));
      return new Response(
        JSON.stringify({ error: `Couldn't reach Paystack: ${String(fetchErr)}` }),
        { status: 502 }
      );
    } finally {
      clearTimeout(timeout);
    }

    const paystackData = await paystackRes.json();
    if (!paystackRes.ok || !paystackData.status) {
      console.error("paystack-initialize-topup: Paystack rejected the request", paystackRes.status, paystackData);
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
    console.error("paystack-initialize-topup: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
