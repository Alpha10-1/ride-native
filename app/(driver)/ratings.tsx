import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import StarRating from "../../src/components/StarRating";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { getMyDriverRatingSummary, getMyReceivedRatings, DriverRatingSummary, RideRating } from "../../src/lib/ratings";

export default function DriverRatingsScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DriverRatingSummary | null>(null);
  const [ratings, setRatings] = useState<RideRating[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyDriverRatingSummary(), getMyReceivedRatings()])
      .then(([s, r]) => {
        if (cancelled) return;
        setSummary(s);
        setRatings(r);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Failed to load ratings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <Screen>
      <RiderHeader subtitle="Ratings & Feedback" onBack={() => router.back()} />
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={{ color: COLORS.textDim, textAlign: "center", paddingHorizontal: SPACE.lg }}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm, paddingTop: SPACE.sm }}
          showsVerticalScrollIndicator={false}
        >
          <GlassCard style={styles.summaryCard}>
            <Text style={styles.avgTxt}>
              {summary && summary.rating_count > 0 ? summary.avg_rating?.toFixed(1) : "—"}
            </Text>
            <StarRating value={summary?.avg_rating ?? 0} size={22} />
            <Text style={styles.countTxt}>
              {summary && summary.rating_count > 0
                ? `Based on ${summary.rating_count} rating${summary.rating_count === 1 ? "" : "s"}`
                : "No ratings yet"}
            </Text>
          </GlassCard>

          {ratings.length > 0 && <Text style={styles.section}>Recent Feedback</Text>}

          {ratings.map((r) => (
            <GlassCard key={r.id} style={{ gap: 6 }}>
              <View style={styles.rowBetween}>
                <StarRating value={r.stars} size={16} />
                <Text style={styles.dateTxt}>
                  {new Date(r.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                </Text>
              </View>
              {r.comment ? <Text style={styles.commentTxt}>{r.comment}</Text> : null}
            </GlassCard>
          ))}

          {!loading && ratings.length === 0 && (
            <Text style={styles.emptyTxt}>
              You haven't received any ratings yet — they'll show up here after your first completed trips.
            </Text>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  summaryCard: { alignItems: "center", gap: 6, paddingVertical: SPACE.md },
  avgTxt: { color: COLORS.text, fontSize: 40, fontWeight: "900" },
  countTxt: { color: COLORS.textFaint, fontSize: 12, fontWeight: "700", marginTop: 2 },
  section: {
    marginTop: SPACE.sm, marginBottom: 2, paddingLeft: 4,
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800",
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateTxt: { color: COLORS.textFaint, fontSize: 11, fontWeight: "700" },
  commentTxt: { color: COLORS.textDim, fontSize: 13, lineHeight: 18 },
  emptyTxt: { color: COLORS.textFaint, fontSize: 13, textAlign: "center", marginTop: SPACE.lg, paddingHorizontal: SPACE.lg, lineHeight: 19 },
});
