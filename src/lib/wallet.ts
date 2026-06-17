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

// Stub top-up: simulates a successful payment without a real payment provider.
export async function stubTopUp(amountCents: number): Promise<Wallet> {
  const { data, error } = await supabase.rpc("stub_topup_wallet", {
    amount_cents_in: amountCents,
  });
  if (error) throw error;
  return data as Wallet;
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