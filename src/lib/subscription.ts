import { supabase } from "./supabase";

export type SubscriptionStatus = "inactive" | "active" | "past_due" | "blocked" | "canceled";

export type SubscriptionGate = {
  allowed: boolean;
  status: SubscriptionStatus;
  reason: string | null;
  nextAmountCents: number;
  gracePeriodEndsAt: string | null;
};

export type SubscriptionPayment = {
  id: string;
  billing_cycle_number: number;
  amount_cents: number;
  currency: string;
  status: "pending" | "success" | "failed";
  failure_reason: string | null;
  attempted_at: string;
  paid_at: string | null;
};

// Pricing shown in the UI ahead of checkout — kept in sync with
// driver_subscription_amount_cents() in the DB migration.
export const INTRO_PRICE_CENTS = 12000; // R120, first 3 months
export const STANDARD_PRICE_CENTS = 15000; // R150, from month 4 onward
export const INTRO_MONTHS = 3;

export async function getMySubscriptionGate(): Promise<SubscriptionGate> {
  const { data, error } = await supabase.rpc("get_my_subscription_gate").single();
  if (error) throw error;
  const row = data as any;
  return {
    allowed: row.allowed,
    status: row.status,
    reason: row.reason,
    nextAmountCents: row.next_amount_cents,
    gracePeriodEndsAt: row.grace_period_ends_at,
  };
}

export type DriverSubscription = {
  status: SubscriptionStatus;
  billing_cycle_count: number;
  card_last4: string | null;
  card_brand: string | null;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
};

export async function getMySubscription(): Promise<DriverSubscription | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("driver_subscriptions")
    .select("status, billing_cycle_count, card_last4, card_brand, current_period_end, grace_period_ends_at")
    .eq("driver_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as DriverSubscription | null;
}

export async function getMySubscriptionPayments(limit = 20): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase
    .from("driver_subscription_payments")
    .select("id, billing_cycle_number, amount_cents, currency, status, failure_reason, attempted_at, paid_at")
    .order("attempted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SubscriptionPayment[];
}

// Starts (or restarts) a subscription checkout. Returns the Paystack
// hosted checkout URL — open it with expo-web-browser. Actual activation
// happens server-side via the paystack-webhook function once Paystack
// confirms the charge, not from anything the client reports back.
export async function startSubscriptionCheckout(): Promise<{ authorizationUrl: string; reference: string; amountCents: number }> {
  const { data, error } = await supabase.functions.invoke("paystack-initialize-subscription");
  if (error) {
    // supabase-js's default error for a non-2xx response is just "Edge
    // Function returned a non-2xx status code" with no detail. The real
    // reason is in the response body (error.context is the raw Response),
    // so pull it out and surface that instead — this is what actually
    // shows up in the "Couldn't start checkout" alert.
    let detail = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) detail = body.error;
    } catch {
      // context wasn't JSON (e.g. a 404 HTML page because the function
      // isn't deployed at all) — fall back to the generic message above.
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return {
    authorizationUrl: data.authorization_url,
    reference: data.reference,
    amountCents: data.amount_cents,
  };
}
