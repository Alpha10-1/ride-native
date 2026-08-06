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

export type RidePaymentStatus = "unpaid" | "pending" | "reserved" | "paid" | "failed";

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

// Starts the "Add card" flow: a Paystack Preauthorization hold that gets
// released automatically the moment it's confirmed (see
// paystack-initialize-card-verification / the webhook's
// preauthorization.reserve.success handler) — the card gets verified and
// saved, but nothing is ever actually charged. Open the returned URL with
// expo-web-browser, same as any other Paystack checkout.
export async function startCardVerification(): Promise<{ authorizationUrl: string; reference: string; amountCents: number }> {
  const data = await invokeAndUnwrap("paystack-initialize-card-verification", {});
  return {
    authorizationUrl: data.authorization_url,
    reference: data.reference,
    amountCents: data.amount_cents,
  };
}

// Places a hold for the ride's agreed fare on the rider's saved card,
// right after a driver accepts a card-paying ride. Best-effort by design
// — the caller should not block on or surface failures here as blocking
// errors; a failed/skipped reservation just means payment happens the
// normal way (chargeRideCard / startRideCardCheckout) at completion.
export async function reserveRideCard(
  rideId: string
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const data = await invokeAndUnwrap("paystack-reserve-ride-card", { ride_id: rideId });
  return { ok: !!data.ok, skipped: data.skipped, error: data.ok === false ? data.error : undefined };
}

// Releases a card hold placed by reserveRideCard, e.g. when a ride gets
// cancelled after a driver already accepted it. Best-effort — a failure
// here just means the hold expires on its own later (Paystack's default
// release window), it doesn't need to block the cancellation.
export async function releaseRideCardReservation(
  rideId: string
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const data = await invokeAndUnwrap("paystack-release-ride-card", { ride_id: rideId });
  return { ok: !!data.ok, skipped: data.skipped, error: data.ok === false ? data.error : undefined };
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

// ============================================
// BANKING DETAILS (record-keeping — refunds/payouts, distinct from the
// card-on-file used for ride payments)
// ============================================
export type BankDetails = {
  bankName: string | null;
  accountHolder: string | null;
  accountNumber: string | null;
  branchCode: string | null;
};

export async function getMyBankDetails(): Promise<BankDetails> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("profiles")
    .select("bank_name, bank_account_holder, bank_account_number, bank_branch_code")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    bankName: data.bank_name,
    accountHolder: data.bank_account_holder,
    accountNumber: data.bank_account_number,
    branchCode: data.bank_branch_code,
  };
}

export async function updateBankDetails(details: {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("update_bank_details", {
    bank_name_in: details.bankName,
    account_holder_in: details.accountHolder,
    account_number_in: details.accountNumber,
    branch_code_in: details.branchCode ?? null,
  });
  if (error) throw error;
}

export async function clearBankDetails(): Promise<void> {
  const { error } = await supabase.rpc("clear_bank_details");
  if (error) throw error;
}
