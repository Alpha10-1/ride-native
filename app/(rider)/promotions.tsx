import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getCurrentProfile } from "../../src/lib/auth";
import {
  getActivePromotions,
  getRedeemedPromotionIds,
  redeemPromotion,
  describeDiscount,
  Promotion,
} from "../../src/lib/promotions";

export default function PromotionsScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [redeemedIds, setRedeemedIds] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    try {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.replace("/auth/login");
        return;
      }
      setRole(profile.role);

      const [promos, redeemed] = await Promise.all([
        getActivePromotions(profile.role),
        getRedeemedPromotionIds(),
      ]);
      setPromotions(promos);
      setRedeemedIds(redeemed);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load promotions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRedeem = async () => {
    if (!code.trim()) return;
    setError(null);
    setSuccess(null);
    setRedeeming(true);
    try {
      await redeemPromotion(code);
      setSuccess("Promotion redeemed successfully.");
      setCode("");
      const redeemed = await getRedeemedPromotionIds();
      setRedeemedIds(redeemed);
    } catch (e: any) {
      setError(e?.message ?? "Failed to redeem promotion.");
    } finally {
      setRedeeming(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Promotions" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Promotions" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <GlassCard>
          <Text style={styles.kicker}>HAVE A CODE?</Text>
          <View style={{ marginTop: SPACE.sm, gap: SPACE.sm }}>
            <TextField
              placeholder="Enter promo code"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
            />
            <PrimaryButton
              label={redeeming ? "Redeeming..." : "Redeem"}
              onPress={handleRedeem}
              disabled={redeeming || !code.trim()}
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {success ? <Text style={styles.success}>{success}</Text> : null}
        </GlassCard>

        <Text style={styles.section}>Available Offers</Text>
        {promotions.length === 0 ? (
          <Text style={styles.empty}>No promotions available right now.</Text>
        ) : (
          promotions.map((promo) => {
            const isRedeemed = redeemedIds.has(promo.id);
            return (
              <GlassCard key={promo.id} style={styles.promoCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.promoTitle}>{promo.title}</Text>
                  {promo.description ? (
                    <Text style={styles.promoDesc}>{promo.description}</Text>
                  ) : null}
                  <View style={styles.promoMetaRow}>
                    <Text style={styles.promoCode}>{promo.code}</Text>
                    <Text style={styles.promoDiscount}>{describeDiscount(promo)}</Text>
                  </View>
                </View>
                {isRedeemed ? (
                  <View style={styles.redeemedBadge}>
                    <Text style={styles.redeemedBadgeText}>Redeemed</Text>
                  </View>
                ) : null}
              </GlassCard>
            );
          })
        )}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  kicker: {
    color: COLORS.textDim,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  section: {
    marginTop: SPACE.md,
    marginBottom: 6,
    paddingLeft: 4,
    color: COLORS.textFaint,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  empty: {
    color: COLORS.textFaint,
    fontSize: 13,
    paddingVertical: SPACE.sm,
  },
  promoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: SPACE.sm,
  },
  promoTitle: {
    color: COLORS.text,
    fontWeight: "900",
    fontSize: 15,
  },
  promoDesc: {
    color: COLORS.textDim,
    fontSize: 12,
    marginTop: 4,
  },
  promoMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    marginTop: SPACE.sm,
  },
  promoCode: {
    color: COLORS.red,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1,
    backgroundColor: "rgba(255,46,46,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.md,
  },
  promoDiscount: {
    color: COLORS.textDim,
    fontSize: 12,
    fontWeight: "700",
  },
  redeemedBadge: {
    backgroundColor: "rgba(120,220,150,0.12)",
    borderWidth: 1,
    borderColor: "rgba(120,220,150,0.3)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  redeemedBadgeText: {
    color: "rgba(120,220,150,0.95)",
    fontSize: 11,
    fontWeight: "800",
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
  },
  success: {
    color: "rgba(120,220,150,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
  },
});