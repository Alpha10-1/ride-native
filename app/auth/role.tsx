import { router } from "expo-router";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE } from "../../src/theme/tokens";

export default function RoleScreen() {
  return (
    <Screen>
      <View style={styles.wrap}>
        <Text style={styles.title}>Continue as</Text>

        <Pressable onPress={() => router.replace("/(rider)/home")}>
          <GlassCard style={styles.card}>
            <Text style={styles.cardTitle}>Rider</Text>
            <Text style={styles.cardSub}>Request rides and track trips</Text>
          </GlassCard>
        </Pressable>

        <Pressable onPress={() => router.replace("/(driver)/home")}>
          <GlassCard style={styles.card}>
            <Text style={styles.cardTitle}>Driver</Text>
            <Text style={styles.cardSub}>Accept trips and earn</Text>
          </GlassCard>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: SPACE.lg,
    gap: SPACE.md,
  },
  title: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: "900",
    marginBottom: SPACE.sm,
  },
  card: { gap: 6 },
  cardTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
  cardSub: { color: COLORS.textDim, fontSize: 13 },
});
