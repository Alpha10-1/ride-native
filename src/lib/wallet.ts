import { supabase } from "./supabase";

export type Wallet = {
  id: string;
  profile_id: string;
  balance_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type WalletTransaction = {
  id: string;
  wallet_id: string;
  amount_cents: number;
  kind: "topup" | "earning" | "ride_charge" | "promo_credit" | "adjustment";
  description: string | null;
  created_at: string;
};

export async function getWallet(): Promise<Wallet> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("profile_id", userId)
    .single();

  if (error) throw error;
  return data;
}

export async function getWalletTransactions(limit = 20): Promise<WalletTransaction[]> {
  const wallet = await getWallet();

  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("*")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// Starts a real-money wallet top-up. Returns a Paystack hosted checkout
// URL — open it with expo-web-browser. The wallet balance only actually
// increases once paystack-webhook confirms the charge server-side; the
// app should refetch the wallet after the browser closes rather than
// assuming success.
export async function startWalletTopUp(
  amountCents: number
): Promise<{ authorizationUrl: string; reference: string; amountCents: number }> {
  const { data, error } = await supabase.functions.invoke("paystack-initialize-topup", {
    body: { amount_cents: amountCents },
  });
  if (error) {
    // supabase-js's default error for a non-2xx response has no detail —
    // the real reason is in the response body, so pull it out instead.
    let detail = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) detail = body.error;
    } catch {
      // context wasn't JSON (e.g. the function isn't deployed) — fall
      // back to the generic message above.
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

// Stub earning: simulates a completed-ride payout for drivers.
export async function stubAddEarning(amountCents: number, description?: string): Promise<Wallet> {
  const { data, error } = await supabase.rpc("stub_add_earning", {
    amount_cents_in: amountCents,
    description_in: description ?? "Stub trip earning",
  });
  if (error) throw error;
  return data as Wallet;
}

export function formatCents(cents: number, currency = "ZAR") {
  const amount = cents / 100;
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
  }).format(amount);
}

export type EarningsSummary = {
  todayCents: number;
  weekCents: number;
  lifetimeCents: number;
  tripsToday: number;
  tripsWeek: number;
  tripsLifetime: number;
};

// Derives today/this-week/lifetime earnings + trip counts from
// wallet_transactions. There's no dedicated earnings-reporting table, so we
// pull recent transactions and aggregate client-side — fine at demo volume.
export async function getEarningsSummary(): Promise<EarningsSummary> {
  const transactions = await getWalletTransactions(500);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  let todayCents = 0;
  let weekCents = 0;
  let lifetimeCents = 0;
  let tripsToday = 0;
  let tripsWeek = 0;
  let tripsLifetime = 0;

  for (const tx of transactions) {
    if (tx.kind !== "earning") continue;
    const created = new Date(tx.created_at);

    lifetimeCents += tx.amount_cents;
    tripsLifetime += 1;

    if (created >= startOfWeek) {
      weekCents += tx.amount_cents;
      tripsWeek += 1;
      if (created >= startOfToday) {
        todayCents += tx.amount_cents;
        tripsToday += 1;
      }
    }
  }

  return { todayCents, weekCents, lifetimeCents, tripsToday, tripsWeek, tripsLifetime };
}