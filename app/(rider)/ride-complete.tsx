import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import StarRating from "../../src/components/StarRating";
import TextField from "../../src/components/TextField";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { Ride, getRideById, formatFare, TIER_CONFIG } from "../../src/lib/rides";
import { TripSlip, getTripSlip } from "../../src/lib/rides";
import {
  RidePaymentStatus, settleRidePayment, chargeRideCard, startRideCardCheckout,
} from "../../src/lib/payments";
import { RideRating, getMyRatingForRide, submitRideRating } from "../../src/lib/ratings";

export default function RideCompleteScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [ride, setRide] = useState<Ride | null>(null);
  const [slip, setSlip] = useState<TripSlip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<RidePaymentStatus | null>(null);
  const [payingNow, setPayingNow] = useState(false);
  const [myRating, setMyRating] = useState<RideRating | null>(null);
  const [ratingLoaded, setRatingLoaded] = useState(false);
  const [selectedStars, setSelectedStars] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);

  useEffect(() => {
    if (!rideId) {
      setError("No ride reference was passed to this screen.");
      return;
    }
    let cancelled = false;
    getRideById(rideId)
      .then(async (r) => {
        if (cancelled) return;
        if (!r) {
          setError("Couldn't find that trip. It may have been removed.");
          return;
        }
        setRide(r);
        setPaymentStatus(r.payment_status ?? null);

        if (r.status === "completed" && r.driver_id) {
          getMyRatingForRide(rideId)
            .then((existing) => {
              if (!cancelled) setMyRating(existing);
            })
            .catch(() => {
              // non-critical — worst case the rider sees the rating form
              // again and a resubmit attempt gets rejected server-side
            })
            .finally(() => {
              if (!cancelled) setRatingLoaded(true);
            });
        } else {
          setRatingLoaded(true);
        }

        // Make sure settlement has actually run for this ride — the
        // driver's device normally triggers it right after completing
        // the trip, but this is idempotent, so calling it again here is
        // harmless and covers the case where the rider's screen gets
        // here first (or the driver-side call failed silently).
        if (r.status === "completed") {
          try {
            const settlement = await settleRidePayment(rideId);
            if (cancelled) return;
            setPaymentStatus(settlement.paymentStatus);
            if (settlement.paymentStatus === "pending" && settlement.method === "card") {
              const result = await chargeRideCard(rideId).catch(() => null);
              if (cancelled) return;
              if (result?.ok) setPaymentStatus("paid");
              else if (result && !result.needsCheckout) setPaymentStatus("failed");
              // if needsCheckout, leave as 'pending' — the "Pay Now" button below handles it
            }
          } catch {
            // non-critical — the payment status pill just won't be fresh yet
          }
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Failed to load trip details.");
      });
    // Poll briefly for slip — it's created server-side on completion
    const attempt = async (retries: number) => {
      try {
        const s = await getTripSlip(rideId);
        if (s) { setSlip(s); return; }
      } catch {
        // slip may just not exist yet; keep retrying quietly
      }
      if (retries > 0 && !cancelled) setTimeout(() => attempt(retries - 1), 1000);
    };
    attempt(5);
    return () => { cancelled = true; };
  }, [rideId]);

  const handlePayNow = async () => {
    if (!rideId) return;
    setPayingNow(true);
    try {
      const result = await chargeRideCard(rideId);
      if (result.ok) {
        setPaymentStatus("paid");
        return;
      }
      if (!result.needsCheckout) {
        setPaymentStatus("failed");
        Alert.alert("Payment failed", result.error ?? "Please try a different card.");
      }
      // Either no saved card, or the saved-card charge failed — open a
      // fresh checkout either way.
      const { authorizationUrl } = await startRideCardCheckout(rideId);
      const browserResult = await WebBrowser.openAuthSessionAsync(authorizationUrl);
      if (browserResult.type === "success" || browserResult.type === "cancel" || browserResult.type === "dismiss") {
        const updated = await getRideById(rideId);
        if (updated) setPaymentStatus(updated.payment_status ?? null);
      }
    } catch (e: any) {
      Alert.alert("Couldn't process payment", e?.message ?? "Please try again.");
    } finally {
      setPayingNow(false);
    }
  };

  const handleSubmitRating = async () => {
    if (!rideId || selectedStars < 1) return;
    setSubmittingRating(true);
    try {
      const saved = await submitRideRating(rideId, selectedStars, ratingComment);
      setMyRating(saved);
    } catch (e: any) {
      Alert.alert("Couldn't submit rating", e?.message ?? "Please try again.");
    } finally {
      setSubmittingRating(false);
    }
  };

  if (error) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <Ionicons name="alert-circle" size={40} color="rgba(255,90,90,0.9)" />
          <Text style={{ color: COLORS.textDim, marginTop: SPACE.sm, textAlign: "center", paddingHorizontal: SPACE.lg }}>
            {error}
          </Text>
          <View style={{ height: SPACE.md }} />
          <PrimaryButton label="Back to Home" onPress={() => router.replace("/(rider)/home")} />
        </View>
      </Screen>
    );
  }

  if (!ride) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <Text style={{ color: COLORS.textDim }}>Loading...</Text>
        </View>
      </Screen>
    );
  }

  const isCancelled = ride.status === "cancelled";
  const fare = isCancelled ? ride.cancellation_fee_cents : ride.final_fare_cents;
  const tierCfg = TIER_CONFIG[ride.ride_tier ?? "economy"];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm, paddingTop: SPACE.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Status icon */}
        <View style={styles.iconWrap}>
          <Ionicons
            name={isCancelled ? "close-circle" : "checkmark-circle"}
            size={64}
            color={isCancelled ? "rgba(255,90,90,0.9)" : "rgba(120,220,150,0.9)"}
          />
        </View>

        <Text style={styles.title}>
          {isCancelled ? "Ride Cancelled" : "You've arrived!"}
        </Text>
        <Text style={styles.subtitle}>
          {isCancelled
            ? ride.cancelled_by === "driver"
              ? "Your driver cancelled this trip."
              : "You cancelled this trip."
            : "Hope you enjoyed your ride."}
        </Text>

        {/* Fare card */}
        {fare ? (
          <GlassCard style={styles.fareCard}>
            <Text style={styles.fareLabel}>
              {isCancelled ? "Cancellation Fee" : "Trip Fare"}
            </Text>
            <Text style={styles.fareAmount}>{formatFare(fare)}</Text>
            <View style={styles.tierBadge}>
              <Ionicons name={tierCfg.icon as any} size={13} color={COLORS.red} />
              <Text style={styles.tierBadgeTxt}>{tierCfg.label}</Text>
            </View>
          </GlassCard>
        ) : null}

        {/* Payment status */}
        {!isCancelled && paymentStatus && paymentStatus !== "unpaid" ? (
          <GlassCard style={styles.paymentCard}>
            {paymentStatus === "paid" ? (
              <>
                <Ionicons name="checkmark-circle" size={18} color="rgba(120,220,150,0.95)" />
                <Text style={styles.paymentTxt}>
                  {ride.payment_method === "cash" ? "Paid in cash" : ride.payment_method === "wallet" ? "Paid from wallet" : "Paid by card"}
                </Text>
              </>
            ) : paymentStatus === "pending" ? (
              <>
                <ActivityIndicator size="small" color={COLORS.textDim} />
                <Text style={styles.paymentTxt}>Processing payment...</Text>
              </>
            ) : (
              <View style={{ flex: 1, gap: SPACE.sm }}>
                <View style={styles.paymentRowInner}>
                  <Ionicons name="alert-circle" size={18} color="rgba(255,90,90,0.9)" />
                  <Text style={styles.paymentTxt}>
                    {ride.payment_method === "wallet" ? "Insufficient wallet balance" : "Card payment failed"}
                  </Text>
                </View>
                <PrimaryButton
                  label={payingNow ? "Processing..." : "Pay by Card"}
                  onPress={handlePayNow}
                  disabled={payingNow}
                />
              </View>
            )}
          </GlassCard>
        ) : null}

        {/* Trip slip */}
        {slip && !isCancelled && (
          <GlassCard style={{ gap: SPACE.sm }}>
            <Text style={styles.slipTitle}>TRIP RECEIPT</Text>

            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>From</Text>
              <Text style={styles.slipVal} numberOfLines={2}>{slip.pickup_address}</Text>
            </View>
            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>To</Text>
              <Text style={styles.slipVal} numberOfLines={2}>{slip.destination_address}</Text>
            </View>

            <View style={styles.slipDivider} />

            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>Distance</Text>
              <Text style={styles.slipVal}>
                {slip.actual_distance_km ? `${slip.actual_distance_km.toFixed(1)} km` : "—"}
              </Text>
            </View>
            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>Duration</Text>
              <Text style={styles.slipVal}>
                {slip.actual_duration_min ? `${Math.round(slip.actual_duration_min)} min` : "—"}
              </Text>
            </View>
            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>Ride type</Text>
              <Text style={styles.slipVal}>{tierCfg.label}</Text>
            </View>

            <View style={styles.slipDivider} />

            {slip.base_fare_cents ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Base fare</Text>
                <Text style={styles.slipVal}>{formatFare(slip.base_fare_cents)}</Text>
              </View>
            ) : null}
            {slip.demand_multiplier ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Demand</Text>
                <Text style={styles.slipVal}>{slip.demand_multiplier}×</Text>
              </View>
            ) : null}
            {slip.tier_multiplier && slip.tier_multiplier !== 1 ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Tier</Text>
                <Text style={styles.slipVal}>{slip.tier_multiplier}×</Text>
              </View>
            ) : null}
            {slip.booking_fee_cents ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Booking fee</Text>
                <Text style={styles.slipVal}>{formatFare(slip.booking_fee_cents)}</Text>
              </View>
            ) : null}

            <View style={styles.slipDivider} />

            <View style={styles.slipRow}>
              <Text style={[styles.slipKey, { color: COLORS.text, fontWeight: "900" }]}>Total</Text>
              <Text style={[styles.slipVal, { color: COLORS.text, fontWeight: "900", fontSize: 16 }]}>
                {slip.final_fare_cents ? formatFare(slip.final_fare_cents) : "—"}
              </Text>
            </View>

            {slip.driver_name && (
              <>
                <View style={styles.slipDivider} />
                <View style={styles.slipRow}>
                  <Text style={styles.slipKey}>Driver</Text>
                  <Text style={styles.slipVal}>{slip.driver_name}</Text>
                </View>
                {slip.driver_username && (
                  <View style={styles.slipRow}>
                    <Text style={styles.slipKey}>Username</Text>
                    <Text style={styles.slipVal}>@{slip.driver_username}</Text>
                  </View>
                )}
              </>
            )}

            {slip.completed_at && (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Date</Text>
                <Text style={styles.slipVal}>
                  {new Date(slip.completed_at).toLocaleString("en-ZA", {
                    dateStyle: "medium", timeStyle: "short",
                  })}
                </Text>
              </View>
            )}
          </GlassCard>
        )}

        {/* Driver rating */}
        {!isCancelled && ride.status === "completed" && ride.driver_id && ratingLoaded && (
          <GlassCard style={{ gap: SPACE.sm, alignItems: "center" }}>
            {myRating ? (
              <>
                <Text style={styles.slipTitle}>YOUR RATING</Text>
                <StarRating value={myRating.stars} size={26} />
                <Text style={styles.paymentTxt}>Thanks for your feedback!</Text>
              </>
            ) : (
              <>
                <Text style={styles.slipTitle}>RATE YOUR DRIVER</Text>
                <StarRating value={selectedStars} onChange={setSelectedStars} size={34} />
                {selectedStars > 0 && (
                  <View style={{ width: "100%", gap: SPACE.sm, marginTop: SPACE.xs }}>
                    <TextField
                      placeholder="Add a comment (optional)"
                      value={ratingComment}
                      onChangeText={setRatingComment}
                      multiline
                      numberOfLines={3}
                    />
                    <PrimaryButton
                      label={submittingRating ? "Submitting..." : "Submit Rating"}
                      onPress={handleSubmitRating}
                      disabled={submittingRating}
                    />
                  </View>
                )}
              </>
            )}
          </GlassCard>
        )}

        <PrimaryButton
          label="Back to Home"
          onPress={() => router.replace("/(rider)/home")}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  iconWrap: { alignItems: "center", marginTop: SPACE.xl },
  title: { color: COLORS.text, fontWeight: "900", fontSize: 28, textAlign: "center", marginTop: SPACE.md },
  subtitle: { color: COLORS.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  fareCard: { alignItems: "center", gap: SPACE.xs },
  fareLabel: { color: COLORS.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: "800" },
  fareAmount: { color: COLORS.text, fontSize: 36, fontWeight: "900" },
  tierBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,46,46,0.1)", borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(255,46,46,0.25)",
  },
  tierBadgeTxt: { color: COLORS.red, fontWeight: "800", fontSize: 12 },
  paymentCard: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  paymentRowInner: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  paymentTxt: { color: COLORS.textDim, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  slipTitle: {
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800",
  },
  slipRow: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
  slipKey: { color: COLORS.textFaint, fontSize: 13, flex: 1 },
  slipVal: { color: COLORS.textDim, fontSize: 13, flex: 2, textAlign: "right" },
  slipDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)" },
});