import { supabase } from "./supabase";

export type Role = "rider" | "driver";

export type Promotion = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: "percent" | "fixed_cents";
  discount_value: number;
  applies_to_role: "rider" | "driver" | null;
  max_redemptions: number | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
};

export type RedeemedPromotion = {
  id: string;
  profile_id: string;
  promotion_id: string;
  redeemed_at: string;
};

export async function getActivePromotions(role: "rider" | "driver"): Promise<Promotion[]> {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .or(`applies_to_role.is.null,applies_to_role.eq.${role}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getRedeemedPromotionIds(): Promise<Set<string>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return new Set();

  const { data, error } = await supabase
    .from("redeemed_promotions")
    .select("promotion_id")
    .eq("profile_id", userId);

  if (error) throw error;
  return new Set((data ?? []).map((r) => r.promotion_id));
}

export async function redeemPromotion(code: string): Promise<RedeemedPromotion> {
  const { data, error } = await supabase.rpc("redeem_promotion", {
    code_in: code.trim(),
  });
  if (error) throw error;
  return data as RedeemedPromotion;
}

export function describeDiscount(promo: Promotion) {
  if (promo.discount_type === "percent") {
    return `${promo.discount_value}% off`;
  }
  const amount = promo.discount_value / 100;
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);
}