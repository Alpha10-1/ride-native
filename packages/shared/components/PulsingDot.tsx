import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

type Props = {
  color?: string;
  size?: number; // diameter of the solid center dot
  ringCount?: number;
};

// Expanding, fading rings around a solid center dot — the classic
// "searching..." radar effect. Purely decorative/looping; safe to mount
// and unmount freely (e.g. only while ride.status === "requested").
export default function PulsingDot({ color = "#FF2E2E", size = 14, ringCount = 3 }: Props) {
  const anims = useRef(
    Array.from({ length: ringCount }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    const loops = anims.map((val, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((i * 1400) / ringCount),
          Animated.timing(val, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);

  return (
    <View style={[styles.wrap, { width: size * 6, height: size * 6 }]}>
      {anims.map((val, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
              transform: [
                { scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 6] }) },
              ],
            },
          ]}
        />
      ))}
      <View style={[styles.core, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 1.5 },
  core: { position: "absolute" },
});