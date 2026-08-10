// Supabase Edge Function: paystack-initialize-card-verification
//
// Starts the "Add card" flow from Payment Methods.
//
// Uses Paystack's Preauthorization API — a hold placed on the card that
// is released immediately once confirmed, so no money ever actually
// moves. This requires a South-Africa-only merchant eligibility flag
// that has to be manually enabled by Paystack support; it's approved on
// this account now (previously it wasn't, so this briefly ran as a real
// R10 charge+refund instead — see git history if that's ever relevant
// again, and 20260807090000_card_verification_refunded_status.sql for
// the status column's leftover 'refunded' value from that period).
//
// Flow:
//   1. This function calls /preauthorization/initialize and returns a
//      checkout URL.
//   2. The rider completes card entry in that checkout. The funds are
//      held, not charged.
//   3. Paystack sends a preauthorization.reserve.success webhook event
//      with metadata.purpose === "card_verification" (handled in
//      paystack-webhook) — that's where the card gets saved to
//      rider_cards, and where the hold gets released right away.
//
// DEPLOY:
//   supabase functions deploy paystack-initialize-card-verification
// SECRETS (shared with the other paystack-* functions):
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "").trim();
const VERIFICATION_AMOUNT_CENTS = 1000; // R10 hold — never captured, released as soon as the webhook confirms it

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), { status: 401, headers: { "Content-Type": "application/json" } });
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
    const riderId = userData.user.id;

    if (!PAYSTACK_SECRET_KEY) {
      console.error("paystack-initialize-card-verification: PAYSTACK_SECRET_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: PAYSTACK_SECRET_KEY is not set." }), { status: 500, headers: { "Content-Type": "application/json" } });
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
      return new Response(JSON.stringify({ error: `Couldn't start verification: ${insertError.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    try {
      const res = await fetch("https://api.paystack.co/preauthorization/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: String(VERIFICATION_AMOUNT_CENTS),
          currency: "ZAR",
          reference,
          expire_after_days: 1, // release the hold ASAP if our own release call below somehow never runs
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
        return new Response(JSON.stringify({ error: reason }), { status: 502, headers: { "Content-Type": "application/json" } });
      }

      return new Response(
        JSON.stringify({
          authorization_url: resData.data.authorization_url,
          reference: resData.data.reference ?? reference,
          amount_cents: VERIFICATION_AMOUNT_CENTS,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (fetchErr) {
      console.error("paystack-initialize-card-verification: fetch to Paystack failed", String(fetchErr));
      await adminClient
        .from("rider_card_verifications")
        .update({ status: "failed", failure_reason: String(fetchErr) })
        .eq("paystack_reference", reference);
      return new Response(JSON.stringify({ error: `Couldn't reach Paystack: ${String(fetchErr)}` }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
  } catch (err) {
    console.error("paystack-initialize-card-verification: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});