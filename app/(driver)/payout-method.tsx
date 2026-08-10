import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  PayoutRequest,
  PayoutStatus,
  getMyBankDetails,
  updateBankDetails,
  clearBankDetails,
  requestPayout,
  getMyPayoutRequests,
} from "../../src/lib/payments";
import { getWallet, formatCents } from "../../src/lib/wallet";

const STATUS_META: Record<PayoutStatus, { label: string; color: string }> = {
  pending: { label: "Pending review", color: "#ffb020" },
  approved: { label: "Approved", color: "rgba(120,180,255,0.95)" },
  paid: { label: "Paid", color: "rgba(120,220,150,0.95)" },
  rejected: { label: "Rejected", color: COLORS.red },
};

export default function DriverPayoutMethodScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [balanceCents, setBalanceCents] = useState(0);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);

  const [bankName, setBankName] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [hasBankDetails, setHasBankDetails] = useState(false);
  const [editingBank, setEditingBank] = useState(false);
  const [savingBank, setSavingBank] = useState(false);

  const [amountInput, setAmountInput] = useState("");
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [bank, wallet, myRequests] = await Promise.all([
        getMyBankDetails(),
        getWallet(),
        getMyPayoutRequests(),
      ]);
      setBankName(bank.bankName ?? "");
      setAccountHolder(bank.accountHolder ?? "");
      setAccountNumber(bank.accountNumber ?? "");
      setBranchCode(bank.branchCode ?? "");
      setHasBankDetails(!!bank.accountNumber);
      setBalanceCents(wallet.balance_cents);
      setRequests(myRequests);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load payout details.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSaveBankDetails = async () => {
    if (!bankName.trim() || !accountHolder.trim() || !accountNumber.trim()) {
      Alert.alert("Missing details", "Bank name, account holder, and account number are required.");
      return;
    }
    setSavingBank(true);
    try {
      await updateBankDetails({
        bankName: bankName.trim(),
        accountHolder: accountHolder.trim(),
        accountNumber: accountNumber.trim(),
        branchCode: branchCode.trim() || undefined,
      });
      setHasBankDetails(true);
      setEditingBank(false);
    } catch (e: any) {
      Alert.alert("Couldn't save banking details", e?.message ?? "Please try again.");
    } finally {
      setSavingBank(false);
    }
  };

  const handleRemoveBankDetails = () => {
    Alert.alert("Remove banking details", "This will delete your saved payout bank account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await clearBankDetails();
            setBankName("");
            setAccountHolder("");
            setAccountNumber("");
            setBranchCode("");
            setHasBankDetails(false);
            setEditingBank(false);
          } catch (e: any) {
            Alert.alert("Couldn't remove details", e?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  const hasPending = requests.some((r) => r.status === "pending");

  const handleRequestPayout = async () => {
    const rands = parseFloat(amountInput.replace(",", "."));
    if (!rands || rands <= 0) {
      Alert.alert("Enter an amount", "Enter how much you'd like to withdraw.");
      return;
    }
    const cents = Math.round(rands * 100);
    if (cents > balanceCents) {
      Alert.alert("Amount too high", "That's more than your available balance.");
      return;
    }
    setRequesting(true);
    try {
      await requestPayout(cents);
      setAmountInput("");
      await load();
      Alert.alert("Payout requested", "We'll review it and pay out to your saved bank account.");
    } catch (e: any) {
      Alert.alert("Couldn't request payout", e?.message ?? "Please try again.");
    } finally {
      setRequesting(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Payout Method" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Payout Method" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.section}>Available Balance</Text>
        <GlassCard>
          <Text style={styles.balanceTxt}>{formatCents(balanceCents)}</Text>
          <Text style={styles.hint}>Withdraw to the bank account below.</Text>
        </GlassCard>

        <Text style={styles.section}>Request Payout</Text>
        {hasBankDetails ? (
          hasPending ? (
            <Text style={styles.hint}>
              You already have a payout request pending review. You can request another once it's been processed.
            </Text>
          ) : (
            <GlassCard style={{ gap: SPACE.sm }}>
              <TextField
                label="Amount (ZAR)"
                placeholder="e.g. 500"
                value={amountInput}
                onChangeText={setAmountInput}
                keyboardType="numeric"
              />
              <PrimaryButton
                label={requesting ? "Requesting..." : "Request Payout"}
                onPress={handleRequestPayout}
                disabled={requesting || balanceCents <= 0}
              />
            </GlassCard>
          )
        ) : (
          <Text style={styles.hint}>Add your bank details below before requesting a payout.</Text>
        )}

        <View style={styles.headerRow}>
          <Text style={[styles.section, { marginTop: SPACE.md }]}>Bank Account</Text>
          {hasBankDetails && !editingBank ? (
            <Pressable onPress={() => setEditingBank(true)} style={styles.editBtn}>
              <Ionicons name="create-outline" size={16} color={COLORS.red} />
              <Text style={styles.editBtnTxt}>Edit</Text>
            </Pressable>
          ) : null}
        </View>

        {hasBankDetails && !editingBank ? (
          <GlassCard style={{ gap: 4 }}>
            <Text style={styles.bankTxt}>{bankName}</Text>
            <Text style={styles.bankSub}>{accountHolder} · •••• {accountNumber.slice(-4)}</Text>
            {branchCode ? <Text style={styles.bankSub}>Branch code: {branchCode}</Text> : null}
            <Pressable onPress={handleRemoveBankDetails} style={{ alignSelf: "flex-start", marginTop: 6 }}>
              <Text style={[styles.editBtnTxt, { color: COLORS.textFaint }]}>Remove</Text>
            </Pressable>
          </GlassCard>
        ) : (
          <GlassCard style={{ gap: SPACE.sm }}>
            <TextField label="Bank Name" placeholder="e.g. FNB" value={bankName} onChangeText={setBankName} autoCapitalize="words" />
            <TextField label="Account Holder" placeholder="Full name on account" value={accountHolder} onChangeText={setAccountHolder} autoCapitalize="words" />
            <TextField label="Account Number" placeholder="Account number" value={accountNumber} onChangeText={setAccountNumber} keyboardType="numeric" />
            <TextField label="Branch Code (optional)" placeholder="e.g. 250655" value={branchCode} onChangeText={setBranchCode} keyboardType="numeric" />
            <PrimaryButton
              label={savingBank ? "Saving..." : "Save Bank Account"}
              onPress={handleSaveBankDetails}
              disabled={savingBank}
            />
            {editingBank ? (
              <Pressable onPress={() => setEditingBank(false)} style={{ alignSelf: "center", marginTop: 2 }}>
                <Text style={styles.editBtnTxt}>Cancel</Text>
              </Pressable>
            ) : null}
          </GlassCard>
        )}

        {requests.length > 0 && (
          <>
            <Text style={[styles.section, { marginTop: SPACE.md }]}>History</Text>
            {requests.map((r) => {
              const meta = STATUS_META[r.status];
              return (
                <GlassCard key={r.id} style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bankTxt}>{formatCents(r.amount_cents)}</Text>
                    <Text style={styles.bankSub}>
                      {new Date(r.requested_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                    {r.admin_notes ? <Text style={styles.bankSub}>{r.admin_notes}</Text> : null}
                  </View>
                  <View style={[styles.statusPill, { borderColor: meta.color }]}>
                    <Text style={[styles.statusPillTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </GlassCard>
              );
            })}
          </>
        )}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: {
    marginTop: SPACE.md,
    marginBottom: 2,
    paddingLeft: 4,
    color: COLORS.textFaint,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  hint: { color: COLORS.textDim, fontSize: 12, paddingLeft: 4, marginTop: 4, lineHeight: 17 },
  error: { color: "rgba(255,90,90,0.95)", marginTop: SPACE.sm, fontWeight: "700", textAlign: "center" },
  balanceTxt: { color: COLORS.text, fontWeight: "900", fontSize: 26 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 4 },
  editBtnTxt: { color: COLORS.red, fontWeight: "800", fontSize: 12 },
  bankTxt: { color: COLORS.text, fontWeight: "700", fontSize: 13 },
  bankSub: { color: COLORS.textFaint, fontSize: 11, marginTop: 2 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  statusPill: {
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillTxt: { fontSize: 10, fontWeight: "900" },
});