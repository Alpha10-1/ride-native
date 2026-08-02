import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  RiderCard,
  getPreferredPaymentMethod,
  setPreferredPaymentMethod,
  getMyCards,
  deleteCard,
} from "../../src/lib/payments";
import { startWalletTopUp } from "../../src/lib/wallet";

const METHODS: { key: PaymentMethod; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
  { key: "cash", icon: "cash-outline", description: "Pay your driver directly at the end of the trip" },
  { key: "wallet", icon: "wallet-outline", description: "Use your pre-loaded wallet balance" },
  { key: "card", icon: "card-outline", description: "Charge your saved card automatically" },
];

export default function PaymentMethodsScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferred, setPreferred] = useState<PaymentMethod>("cash");
  const [cards, setCards] = useState<RiderCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pref, myCards] = await Promise.all([getPreferredPaymentMethod(), getMyCards()]);
      setPreferred(pref);
      setCards(myCards);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load payment methods.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSelect = async (method: PaymentMethod) => {
    if (method === preferred || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setPreferredPaymentMethod(method);
      setPreferred(method);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't update your default payment method.");
    } finally {
      setSaving(false);
    }
  };

  // A saved card only exists after a successful card ride payment or
  // wallet top-up checkout — there's no separate "verify a card" flow
  // here, so this opens a small top-up (the least the rider can commit
  // to) purely so a real card gets saved via the checkout webhook.
  const handleAddCard = async () => {
    setSaving(true);
    setError(null);
    try {
      const { authorizationUrl } = await startWalletTopUp(1000); // R10 minimum
      const result = await WebBrowser.openAuthSessionAsync(authorizationUrl);
      if (result.type === "success" || result.type === "cancel" || result.type === "dismiss") {
        await load();
      }
    } catch (e: any) {
      Alert.alert("Couldn't add card", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCard = (card: RiderCard) => {
    Alert.alert(
      "Remove card",
      `Remove ${card.card_brand ? card.card_brand.toUpperCase() + " " : ""}•••• ${card.card_last4 ?? ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCard(card.id);
              setCards((prev) => prev.filter((c) => c.id !== card.id));
            } catch (e: any) {
              Alert.alert("Couldn't remove card", e?.message ?? "Please try again.");
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Payment Methods" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Payment Methods" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.section}>Default Method</Text>
        <Text style={styles.hint}>
          Used for new ride requests. You can still change it for a specific ride when you book.
        </Text>

        {METHODS.map((m) => {
          const isSelected = preferred === m.key;
          return (
            <Pressable
              key={m.key}
              style={[styles.methodCard, isSelected && styles.methodCardSelected]}
              onPress={() => handleSelect(m.key)}
              disabled={saving}
            >
              <View style={styles.methodIconWrap}>
                <Ionicons name={m.icon} size={20} color={isSelected ? "#000" : COLORS.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodLabel}>{PAYMENT_METHOD_LABELS[m.key]}</Text>
                <Text style={styles.methodDesc}>{m.description}</Text>
              </View>
              {isSelected ? (
                <Ionicons name="checkmark-circle" size={20} color={COLORS.red} />
              ) : (
                <Ionicons name="ellipse-outline" size={20} color={COLORS.textFaint} />
              )}
            </Pressable>
          );
        })}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.cardsHeaderRow}>
          <Text style={[styles.section, { marginTop: SPACE.md }]}>Saved Cards</Text>
          <Pressable onPress={handleAddCard} disabled={saving} style={styles.addCardBtn}>
            <Ionicons name="add-circle-outline" size={16} color={COLORS.red} />
            <Text style={styles.addCardTxt}>{saving ? "Opening…" : "Add card"}</Text>
          </Pressable>
        </View>

        {cards.length === 0 ? (
          <Text style={styles.empty}>
            No saved cards yet. Add one, or a card will be saved automatically the next time you pay for a ride by card.
          </Text>
        ) : (
          cards.map((card) => (
            <GlassCard key={card.id} style={styles.cardRow}>
              <Ionicons name="card-outline" size={18} color={COLORS.textDim} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTxt}>
                  {card.card_brand ? `${card.card_brand.toUpperCase()} ` : ""}•••• {card.card_last4 ?? "????"}
                </Text>
                {card.card_exp_month && card.card_exp_year ? (
                  <Text style={styles.cardExp}>Expires {card.card_exp_month}/{card.card_exp_year}</Text>
                ) : null}
              </View>
              {card.is_default ? (
                <View style={styles.defaultPill}>
                  <Text style={styles.defaultPillTxt}>DEFAULT</Text>
                </View>
              ) : null}
              <Pressable onPress={() => handleRemoveCard(card)} style={{ padding: 4 }}>
                <Ionicons name="trash-outline" size={18} color={COLORS.textFaint} />
              </Pressable>
            </GlassCard>
          ))
        )}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
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
  hint: { color: COLORS.textDim, fontSize: 12, paddingLeft: 4, marginBottom: SPACE.sm, lineHeight: 17 },
  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    padding: SPACE.sm,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  methodCardSelected: {
    borderColor: COLORS.red,
    backgroundColor: "rgba(255,46,46,0.08)",
  },
  methodIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  methodLabel: { color: COLORS.text, fontWeight: "800", fontSize: 14 },
  methodDesc: { color: COLORS.textFaint, fontSize: 12, marginTop: 2 },
  error: { color: "rgba(255,90,90,0.95)", marginTop: SPACE.sm, fontWeight: "700", textAlign: "center" },
  cardsHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  addCardBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 4 },
  addCardTxt: { color: COLORS.red, fontWeight: "800", fontSize: 12 },
  empty: { color: COLORS.textFaint, fontSize: 13, paddingVertical: SPACE.sm, lineHeight: 18 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  cardTxt: { color: COLORS.text, fontWeight: "700", fontSize: 13 },
  cardExp: { color: COLORS.textFaint, fontSize: 11, marginTop: 2 },
  defaultPill: {
    backgroundColor: "rgba(120,220,150,0.12)",
    borderColor: "rgba(120,220,150,0.4)",
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  defaultPillTxt: { color: "rgba(120,220,150,0.95)", fontSize: 9, fontWeight: "900" },
});
