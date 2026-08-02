import { supabase } from "./supabase";

export type PaymentMethod = "wallet" | "card" | "cash";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  wallet: "Wallet",
  card: "Card",
  cash: "Cash",
};

export type RiderCard = {
  id: string;
  card_last4: string | null;
  card_brand: string | null;
  card_exp_month: string | null;
  card_exp_year: string | null;
  is_default: boolean;
  created_at: string;
};

export type RidePaymentStatus = "unpaid" | "pending" | "paid" | "failed";

export type RidePaymentSettlement = {
  paymentStatus: RidePaymentStatus;
  method: PaymentMethod;
  amountCents: number;
  message: string | null;
};

// ============================================
// PREFERENCE
// ============================================
export async function getPreferredPaymentMethod(): Promise<PaymentMethod> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("profiles")
    .select("preferred_payment_method")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return (data?.preferred_payment_method ?? "cash") as PaymentMethod;
}

export async function setPreferredPaymentMethod(method: PaymentMethod): Promise<void> {
  const { error } = await supabase.rpc("set_preferred_payment_method", { method_in: method });
  if (error) throw error;
}

// ============================================
// PER-RIDE SELECTION
// ============================================
// Best-effort follow-up call after requestRide()/requestScheduledRide()
// succeeds, mirroring how proposeRiderFare is used elsewhere — a new
// ride already defaults to the rider's preferred method server-side, so
// this only needs to run when the rider picked something different for
// this one trip.
export async function setRidePaymentMethod(rideId: string, method: PaymentMethod): Promise<void> {
  const { error } = await supabase.rpc("set_ride_payment_method", {
    ride_id_in: rideId,
    method_in: method,
  });
  if (error) throw error;
}

// ============================================
// SAVED CARDS
// ============================================
export async function getMyCards(): Promise<RiderCard[]> {
  const { data, error } = await supabase
    .from("rider_cards")
    .select("id, card_last4, card_brand, card_exp_month, card_exp_year, is_default, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RiderCard[];
}

export async function deleteCard(cardId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_rider_card", { card_id_in: cardId });
  if (error) throw error;
}

// ============================================
// RIDE PAYMENT SETTLEMENT
// ============================================
// Call once a ride's status is 'completed' (from either the driver's or
// rider's device). Settles cash/wallet immediately server-side; for
// card, this only marks 'pending' — follow up with chargeRideCard() (or
// startRideCardCheckout() if that reports needs_checkout) to actually
// take payment.
export async function settleRidePayment(rideId: string): Promise<RidePaymentSettlement> {
  const { data, error } = await supabase
    .rpc("settle_ride_payment", { ride_id_in: rideId })
    .single();
  if (error) throw error;
  const row = data as any;
  return {
    paymentStatus: row.payment_status,
    method: row.method,
    amountCents: row.amount_cents,
    message: row.message,
  };
}

function extractFunctionError(error: any): string {
  return error?.message ?? "Something went wrong.";
}

async function invokeAndUnwrap(functionName: string, body?: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    let detail = extractFunctionError(error);
    try {
      const respBody = await error.context?.json();
      if (respBody?.error) detail = respBody.error;
    } catch {
      // not JSON — keep the generic message
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Tries to charge the rider's saved card for a completed ride, no
// checkout screen needed. If they have no saved card yet, the function
// reports needs_checkout instead of erroring — fall back to
// startRideCardCheckout() in that case.
export async function chargeRideCard(rideId: string): Promise<{ ok: boolean; needsCheckout: boolean; error?: string }> {
  const data = await invokeAndUnwrap("paystack-charge-ride-card", { ride_id: rideId });
  return {
    ok: !!data.ok,
    needsCheckout: !!data.needs_checkout,
    error: data.ok === false ? data.error : undefined,
  };
}

// Starts a fresh Paystack checkout for a ride's fare — used when the
// rider has no saved card, or a saved-card charge failed and they want
// to try a different one. Returns a checkout URL; open with
// expo-web-browser. The webhook marks the ride paid once Paystack
// confirms the charge, and saves the card used for next time.
export async function startRideCardCheckout(
  rideId: string
): Promise<{ authorizationUrl: string; reference: string; amountCents: number }> {
  const data = await invokeAndUnwrap("paystack-initialize-ride-checkout", { ride_id: rideId });
  return {
    authorizationUrl: data.authorization_url,
    reference: data.reference,
    amountCents: data.amount_cents,
  };
}
