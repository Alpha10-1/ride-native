import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { COLORS, RADIUS } from "../theme/tokens";

type TabKey = "login" | "register";

export default function SegmentedTabs({
  value,
  onChange,
}: {
  value: TabKey;
  onChange: (v: TabKey) => void;
}) {
  const indicatorStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateX: withTiming(value === "login" ? "0%" : "100%", {
            duration: 180,
          }),
        },
      ],
    };
  }, [value]);

  return (
    <View style={styles.wrap}>
      <Animated.View
        pointerEvents="none"
        style={[styles.indicator, indicatorStyle]}
      />

      <Pressable onPress={() => onChange("login")} style={styles.btn}>
        <Text style={[styles.txt, value === "login" && styles.activeTxt]}>Login</Text>
      </Pressable>

      <Pressable onPress={() => onChange("register")} style={styles.btn}>
        <Text style={[styles.txt, value === "register" && styles.activeTxt]}>Register</Text>
      </Pressable>
    </View>
  );
}

const INDICATOR_W = 0.5;


const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    flexDirection: "row",
    backgroundColor: "rgba(10,10,10,0.85)",
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: "rgba(255,46,46,0.06)",
    padding: 6,
    overflow: "hidden",
  },
  indicator: {
    position: "absolute",
    top: 6,
    bottom: 6,
    left: 6,
    width: "50%",
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  btn: {
    flex: 1,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.pill,
  },
  txt: {
    color: "rgba(255,255,255,0.7)",
    fontWeight: "800",
  },
  activeTxt: {
    color: COLORS.text,
  },
});
