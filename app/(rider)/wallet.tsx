import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import RowItem from "../../src/components/RowItem";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { getCurrentProfile } from "../../src/lib/auth";
import {
  getWallet,
  getWalletTransactions,
  stubTopUp,
  stubAddEarning,
  formatCents,
  Wallet,
  WalletTransaction,
} from "../../src/lib/wallet";

const TOPUP_AMOUNTS_CENTS = [5000, 10000, 20000, 50000]; // R50, R100, R200, R500
const STUB_EARNING_CENTS = 8500; // R85, simulating a completed trip payout

export default function WalletScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  const load = useCallback(async () => {
    try {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.replace("/auth/login");
        return;
      }
      setRole(profile.role);

      const [walletData, txData] = await Promise.all([
        getWallet(),
        getWalletTransactions(15),
      ]);
      setWallet(walletData);
      setTransactions(txData);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load wallet.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleTopUp = async (amountCents: number) => {
    setError(null);
    setActionLoading(true);
    try {
      const updated = await stubTopUp(amountCents);
      setWallet(updated);
      const tx = await getWalletTransactions(15);
      setTransactions(tx);
    } catch (e: any) {
      setError(e?.message ?? "Top-up failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSimulateEarning = async () => {
    setError(null);
    setActionLoading(true);
    try {
      const updated = await stubAddEarning(STUB_EARNING_CENTS, "Simulated trip payout");
      setWallet(updated);
      const tx = await getWalletTransactions(15);
      setTransactions(tx);
    } catch (e: any) {
      setError(e?.message ?? "Failed to record earning.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle={role === "driver" ? "Earnings" : "Wallet"} menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle={role === "driver" ? "Earnings" : "Wallet"} menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>
            {role === "driver" ? "Available Earnings" : "Wallet Balance"}
          </Text>
          <Text style={styles.balanceAmount}>
            {wallet ? formatCents(wallet.balance_cents, wallet.currency) : "—"}
          </Text>
        </GlassCard>

        {role === "rider" ? (
          <>
            <Text style={styles.section}>Top Up</Text>
            <View style={styles.amountGrid}>
              {TOPUP_AMOUNTS_CENTS.map((amount) => (
                <View key={amount} style={styles.amountBtnWrap}>
                  <PrimaryButton
                    label={formatCents(amount)}
                    onPress={() => handleTopUp(amount)}
                    disabled={actionLoading}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.note}>
              This is a simulated top-up for development. No real payment is processed yet.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.section}>Earnings</Text>
            <PrimaryButton
              label={actionLoading ? "Processing..." : "Simulate Completed Trip"}
              onPress={handleSimulateEarning}
              disabled={actionLoading}
            />
            <Text style={styles.note}>
              This simulates a payout from a completed trip for development. Real ride-based earnings will replace this later.
            </Text>
          </>
        )}

        <Text style={styles.section}>Recent Activity</Text>
        {transactions.length === 0 ? (
          <Text style={styles.empty}>No transactions yet.</Text>
        ) : (
          transactions.map((tx) => (
            <RowItem
              key={tx.id}
              title={tx.description ?? tx.kind}
              subtitle={new Date(tx.created_at).toLocaleString()}
              icon={tx.amount_cents >= 0 ? "arrow-down-circle-outline" : "arrow-up-circle-outline"}
              showChevron={false}
              onPress={() => {}}
            />
          ))
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  balanceCard: {
    alignItems: "center",
    paddingVertical: SPACE.lg,
  },
  balanceLabel: {
    color: COLORS.textFaint,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  balanceAmount: {
    color: COLORS.text,
    fontSize: 38,
    fontWeight: "900",
    marginTop: 8,
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
  amountGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACE.sm,
  },
  amountBtnWrap: {
    width: "47%",
  },
  note: {
    color: COLORS.textFaint,
    fontSize: 12,
    marginTop: SPACE.sm,
    fontStyle: "italic",
  },
  empty: {
    color: COLORS.textFaint,
    fontSize: 13,
    paddingVertical: SPACE.sm,
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});