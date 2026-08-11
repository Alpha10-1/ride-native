import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Alert } from "../../src/lib/themedAlert";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { formatCents } from "../../src/lib/wallet";
import {
  SubscriptionStatus, DriverSubscription, SubscriptionPayment,
  INTRO_PRICE_CENTS, STANDARD_PRICE_CENTS, INTRO_MONTHS,
  getMySubscription, getMySubscriptionPayments, startSubscriptionCheckout,
} from "../../src/lib/subscription";

const STATUS_META: Record<SubscriptionStatus, { label: string; color: string }> = {
  inactive: { label: "Not set up", color: COLORS.textDim },
  active: { label: "Active", color: "rgba(120,220,150,0.95)" },
  past_due: { label: "Payment failed", color: "#ffb020" },
  blocked: { label: "Blocked", color: COLORS.red },
  canceled: { label: "Canceled", color: COLORS.textDim },
};

const PAYMENT_STATUS_META: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  success: { label: "Paid", color: "rgba(120,220,150,0.95)", icon: "checkmark-circle" },
  pending: { label: "Pending", color: "#ffb020", icon: "time-outline" },
  failed: { label: "Failed", color: COLORS.red, icon: "close-circle" },
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default function DriverSubscriptionScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [sub, setSub] = useState<DriverSubscription | null>(null);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([getMySubscription(), getMySubscriptionPayments()]);
      setSub(s);
      setPayments(p);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load subscription.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handlePay = async () => {
    setCheckingOut(true);
    setError(null);
    try {
      const { authorizationUrl } = await startSubscriptionCheckout();
      const result = await WebBrowser.openAuthSessionAsync(authorizationUrl);
      // We don't trust the browser result for activation — the webhook is
      // the source of truth — but once the browser closes, refresh so an
      // already-processed webhook shows up right away.
      if (result.type === "success" || result.type === "cancel" || result.type === "dismiss") {
        await load();
      }
    } catch (e: any) {
      Alert.alert("Couldn't start checkout", e?.message ?? "Please try again.");
    } finally {
      setCheckingOut(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Subscription" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
      </Screen>
    );
  }

  const status: SubscriptionStatus = sub?.status ?? "inactive";
  const meta = STATUS_META[status];
  const cycleCount = sub?.billing_cycle_count ?? 0;
  const nextAmountCents = cycleCount < INTRO_MONTHS ? INTRO_PRICE_CENTS : STANDARD_PRICE_CENTS;
  const graceDaysLeft = daysUntil(sub?.grace_period_ends_at ?? null);
  const needsAction = status === "inactive" || status === "past_due" || status === "blocked" || status === "canceled";

  return (
    <Screen>
      <RiderHeader subtitle="Subscription" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard>
          <View style={styles.statusRow}>
            <Text style={styles.kicker}>SUBSCRIPTION STATUS</Text>
            <View style={[styles.statusPill, { borderColor: meta.color }]}>
              <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
              <Text style={[styles.statusPillTxt, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>

          <Text style={styles.sub}>
            {status === "active" &&
              `You're all set. Your card is charged automatically each month — no action needed.`}
            {status === "inactive" &&
              `Pay to start receiving ride requests. R${INTRO_PRICE_CENTS / 100} a month for your first ${INTRO_MONTHS} months, then R${STANDARD_PRICE_CENTS / 100} a month after that.`}
            {status === "past_due" &&
              `Your last payment failed.${graceDaysLeft != null ? ` You have ${graceDaysLeft} day${graceDaysLeft === 1 ? "" : "s"} left` : ""} to update your card before you're blocked from going online.`}
            {status === "blocked" &&
              `You're blocked from going online because a subscription payment wasn't made in time. Pay now to reactivate.`}
            {status === "canceled" &&
              `Your subscription was canceled. Resubscribe to go online again.`}
          </Text>

          {sub?.card_last4 ? (
            <View style={styles.cardRow}>
              <Ionicons name="card-outline" size={16} color={COLORS.textDim} />
              <Text style={styles.cardTxt}>
                {sub.card_brand ? `${sub.card_brand.toUpperCase()} ` : ""}•••• {sub.card_last4}
              </Text>
            </View>
          ) : null}
        </GlassCard>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GlassCard>
          <Text style={styles.kicker}>NEXT PAYMENT</Text>
          <Text style={styles.amount}>{formatCents(nextAmountCents)}</Text>
          <Text style={styles.sub}>
            {cycleCount < INTRO_MONTHS
              ? `Intro rate — month ${cycleCount + 1} of ${INTRO_MONTHS} at R${INTRO_PRICE_CENTS / 100}`
              : `Standard monthly rate`}
          </Text>
          {sub?.current_period_end && status === "active" ? (
            <Text style={styles.sub}>
              Next charge on {new Date(sub.current_period_end).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" })}
            </Text>
          ) : null}
        </GlassCard>

        {needsAction ? (
          <PrimaryButton
            label={checkingOut ? "Opening checkout…" : `Pay ${formatCents(nextAmountCents)}`}
            onPress={handlePay}
            disabled={checkingOut}
          />
        ) : null}

        {payments.length > 0 ? (
          <>
            <Text style={styles.section}>Payment History</Text>
            {payments.map((p) => {
              const pMeta = PAYMENT_STATUS_META[p.status];
              return (
                <GlassCard key={p.id} style={styles.paymentCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paymentTitle}>Cycle {p.billing_cycle_number + 1}</Text>
                    <Text style={styles.paymentDate}>
                      {new Date(p.attempted_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                    </Text>
                    {p.failure_reason ? <Text style={styles.failureReason}>{p.failure_reason}</Text> : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.paymentAmount}>{formatCents(p.amount_cents, p.currency)}</Text>
                    <View style={styles.paymentStatusRow}>
                      <Ionicons name={pMeta.icon} size={13} color={pMeta.color} />
                      <Text style={[styles.paymentStatusTxt, { color: pMeta.color }]}>{pMeta.label}</Text>
                    </View>
                  </View>
                </GlassCard>
              );
            })}
          </>
        ) : null}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
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
  sub: { color: COLORS.textDim, marginTop: 8, fontSize: 13, lineHeight: 18 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillTxt: { fontSize: 11, fontWeight: "800" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  cardTxt: { color: COLORS.textDim, fontSize: 13, fontWeight: "700" },
  amount: { color: COLORS.text, fontSize: 28, fontWeight: "900", marginTop: 6 },
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
  paymentCard: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  paymentTitle: { color: COLORS.text, fontWeight: "900", fontSize: 14 },
  paymentDate: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  failureReason: { color: COLORS.red, fontSize: 11, marginTop: 4 },
  paymentAmount: { color: COLORS.text, fontWeight: "900", fontSize: 14 },
  paymentStatusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  paymentStatusTxt: { fontSize: 11, fontWeight: "800" },
  error: { color: "rgba(255,90,90,0.95)", fontWeight: "700", paddingHorizontal: 4 },
});
