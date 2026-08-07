// Supabase Edge Function: paystack-initialize-card-verification
//
// Starts the "Add card" flow from Payment Methods.
//
// This used to call Paystack's Preauthorization API (a hold-then-release
// with no money moving), but that API is gated behind a South-Africa-only
// merchant eligibility flag that has to be manually enabled by Paystack
// support — until that's approved, /preauthorization/initialize just
// fails outright with "merchant is not eligible for authorization".
//
// Plain card charge+refund via /transaction/initialize has no such
// gating and works in every market — this function now does a real R10
// charge instead. The tradeoff: unlike a released hold, a processed
// refund can take up to 10 business days to actually land back with the
// rider, even though the card is saved and usable immediately. Worth
// reflecting that in the "Add card" UI copy if it doesn't already.
//
// Flow:
//   1. This function calls /transaction/initialize and returns a
//      checkout URL, same shape as paystack-initialize-topup.
//   2. The rider completes card entry in that checkout.
//   3. Paystack sends a charge.success webhook event with
//      metadata.purpose === "card_verification" (handled in
//      paystack-webhook) — that's where the card actually gets saved to
//      rider_cards, and where the refund gets kicked off.
//
// DEPLOY:
//   supabase functions deploy paystack-initialize-card-verification
// SECRETS (shared with the other paystack-* functions):
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();
const VERIFICATION_AMOUNT_CENTS = 1000; // R10 — small enough to be a trivial refund, large enough to look like a real charge to the card issuer's fraud checks

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
    }
    const riderId = userData.user.id;

    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-initialize-card-verification: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", riderId)
      .single();
    const email = profile?.email || `${riderId}@ridenative.internal`;

    const reference = `cardverify_${riderId}_${Date.now()}`;

    const { error: insertError } = await adminClient.from("rider_card_verifications").insert({
      rider_id: riderId,
      amount_cents: VERIFICATION_AMOUNT_CENTS,
      currency: "ZAR",
      status: "pending",
      paystack_reference: reference,
    });
    if (insertError) {
      console.error("paystack-initialize-card-verification: insert failed", insertError);
      return new Response(JSON.stringify({ error: `Couldn't start verification: ${insertError.message}` }), { status: 500 });
    }

    try {
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: VERIFICATION_AMOUNT_CENTS,
          currency: "ZAR",
          reference,
          metadata: { rider_id: riderId, purpose: "card_verification" },
        }),
      });
      const resData: any = await res.json();

      if (!res.ok || !resData?.status || !resData?.data?.authorization_url) {
        const reason = resData?.message ?? "Couldn't start card verification.";
        await adminClient
          .from("rider_card_verifications")
          .update({ status: "failed", failure_reason: reason })
          .eq("paystack_reference", reference);
        return new Response(JSON.stringify({ error: reason }), { status: 502 });
      }

      return new Response(
        JSON.stringify({
          authorization_url: resData.data.authorization_url,
          reference: resData.data.reference ?? reference,
          amount_cents: VERIFICATION_AMOUNT_CENTS,
        }),
        { status: 200 }
      );
    } catch (fetchErr) {
      console.error("paystack-initialize-card-verification: fetch to Paystack failed", String(fetchErr));
      await adminClient
        .from("rider_card_verifications")
        .update({ status: "failed", failure_reason: String(fetchErr) })
        .eq("paystack_reference", reference);
      return new Response(JSON.stringify({ error: `Couldn't reach Paystack: ${String(fetchErr)}` }), { status: 502 });
    }
  } catch (err) {
    console.error("paystack-initialize-card-verification: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});