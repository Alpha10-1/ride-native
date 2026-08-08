import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../theme/tokens";

const GOLD = "#ffc94d";

// Interactive when onChange is passed (tappable stars, e.g. rider rating
// a driver). Read-only display otherwise (e.g. a driver's average rating
// badge) — value can be fractional in that case and renders half-filled
// stars accordingly.
export default function StarRating({
  value,
  onChange,
  size = 32,
  count,
}: {
  value: number;
  onChange?: (stars: number) => void;
  size?: number;
  count?: number; // optional "(count)" label next to read-only stars
}) {
  const interactive = !!onChange;

  return (
    <View style={styles.row}>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((i) => {
          const filled = value >= i;
          const half = !filled && value > i - 1;
          const iconName = interactive ? (filled ? "star" : "star-outline") : half ? "star-half" : filled ? "star" : "star-outline";
          const Star = (
            <Ionicons
              key={i}
              name={iconName as any}
              size={size}
              color={filled || half ? GOLD : COLORS.textFaint}
              style={{ marginRight: 2 }}
            />
          );
          if (!interactive) return Star;
          return (
            <Pressable key={i} onPress={() => onChange!(i)} hitSlop={8}>
              {Star}
            </Pressable>
          );
        })}
      </View>
      {typeof count === "number" && (
        <Text style={styles.countTxt}>({count})</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  stars: { flexDirection: "row", alignItems: "center" },
  countTxt: { color: COLORS.textFaint, fontSize: 13, fontWeight: "700" },
});
