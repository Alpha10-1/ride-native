import React from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";

export default function RiderTrip() {
  return (
    <Screen>
      <RiderHeader subtitle="Finding driver" onBack={() => router.back()} />

      <View style={{ padding: SPACE.md, gap: SPACE.md }}>
        <GlassCard>
          <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: "900" }}>Searching nearby…</Text>
          <Text style={{ color: COLORS.textDim, marginTop: 8 }}>ETA will appear here (demo).</Text>
        </GlassCard>

        <PrimaryButton label="Cancel Request" onPress={() => router.replace("/(rider)/home")} />
      </View>
    </Screen>
  );
}
