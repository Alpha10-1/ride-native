import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Dimensions, PanResponder,
  Platform, Pressable, ScrollView, StyleSheet, View,
} from "react-native";
import { RADIUS } from "../theme/tokens";

type Props = {
  children: React.ReactNode;
  handleHeight?: number;
  topGap?: number; // how far from the top of the screen the sheet stops when expanded
  peekHeight?: number; // how much stays visible when collapsed
  defaultExpanded?: boolean;
  scrollable?: boolean;
};

// A lightweight, tab-free bottom sheet: drag the handle to collapse it down
// to a small peek (revealing the map underneath), or expand it back up.
// Content scrolls internally via a ScrollView when it doesn't fit.
export default function DraggableSheet({
  children,
  handleHeight = 28,
  topGap = 140,
  peekHeight = 96,
  defaultExpanded = true,
  scrollable = true,
}: Props) {
  const [vh, setVh] = useState(Dimensions.get("window").height);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setVh(window.height));
    return () => sub.remove();
  }, []);

  const sheetHeight = useMemo(() => Math.max(vh - topGap, 200), [vh, topGap]);
  const collapsedTranslate = useMemo(
    () => Math.max(sheetHeight - peekHeight, 0),
    [sheetHeight, peekHeight]
  );

  const [expanded, setExpanded] = useState(defaultExpanded);
  const translateY = useRef(new Animated.Value(defaultExpanded ? 0 : collapsedTranslate)).current;
  const currentTranslateY = useRef(defaultExpanded ? 0 : collapsedTranslate);
  const collapsedRef = useRef(collapsedTranslate);
  useEffect(() => { collapsedRef.current = collapsedTranslate; }, [collapsedTranslate]);

  useEffect(() => {
    const toValue = expanded ? 0 : collapsedTranslate;
    currentTranslateY.current = toValue;
    Animated.spring(translateY, { toValue, useNativeDriver: true, tension: 120, friction: 18 }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, collapsedTranslate]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 6 && Math.abs(gs.dy) > Math.abs(gs.dx),

      onPanResponderGrant: () => {
        translateY.stopAnimation((val) => { currentTranslateY.current = val; });
      },
      onPanResponderMove: (_, gs) => {
        const next = Math.max(0, Math.min(collapsedRef.current, currentTranslateY.current + gs.dy));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        const current = Math.max(0, Math.min(collapsedRef.current, currentTranslateY.current + gs.dy));
        const midpoint = collapsedRef.current / 2;
        const shouldExpand = Math.abs(gs.vy) > 0.5 ? gs.vy < 0 : current < midpoint;
        setExpanded(shouldExpand);
      },
    })
  ).current;

  return (
    <Animated.View style={[styles.sheet, { height: sheetHeight, transform: [{ translateY }] }]}>
      <View {...panResponder.panHandlers} style={[styles.handleWrap, { height: handleHeight }]}>
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={Platform.OS === "web" ? ({ cursor: "pointer" } as any) : undefined}
        >
          <View style={styles.grabber} />
        </Pressable>
      </View>
      {scrollable ? (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        // No ScrollView wrapper at all when content manages its own
        // scrolling (e.g. a FlatList of search suggestions) — wrapping a
        // VirtualizedList in a ScrollView triggers React Native's nested-
        // list warning/breakage even with scrollEnabled={false}, since the
        // check is based on the component tree, not runtime scroll state.
        <View style={[styles.content, styles.scrollContent, { flex: 1 }]}>
          {children}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "#070707",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    overflow: "hidden",
  },
  handleWrap: { alignItems: "center", justifyContent: "center" },
  grabber: { width: 44, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.2)" },
  content: { flex: 1, paddingHorizontal: 16 },
  scrollContent: { paddingBottom: 32 },
});