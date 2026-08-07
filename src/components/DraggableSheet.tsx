import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Dimensions, Keyboard, KeyboardEvent, PanResponder,
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
//
// Sized to its actual content (measured via onLayout/onContentSizeChange),
// capped at (screen height - topGap) — never just fixed to that cap. A short
// bit of content (e.g. the search step with one saved place) gets a short
// sheet, not one that stretches to fill the screen with dead space. When the
// keyboard opens, the cap additionally shrinks by the keyboard's height so
// the sheet never extends underneath it, and the sheet forces itself
// expanded so a focused input can't end up hidden behind a collapsed peek.
export default function DraggableSheet({
  children,
  handleHeight = 28,
  topGap = 140,
  peekHeight = 96,
  defaultExpanded = true,
  scrollable = true,
}: Props) {
  const [vh, setVh] = useState(Dimensions.get("window").height);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setVh(window.height));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: KeyboardEvent) => setKeyboardHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardHeight(0);
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Upper bound the sheet may grow to: normally (screen - topGap), and
  // additionally reduced by the keyboard height so an open keyboard can
  // never sit on top of (or push under) the sheet's own content.
  const maxHeight = useMemo(
    () => Math.max(vh - topGap - keyboardHeight, 200),
    [vh, topGap, keyboardHeight]
  );

  // Actual sheet height: the content's natural height (plus the drag
  // handle), clamped between a sane minimum and maxHeight above. Before the
  // first layout pass contentHeight is 0, so fall back to maxHeight to
  // avoid a flash of a too-short sheet.
  const sheetHeight = useMemo(() => {
    if (contentHeight <= 0) return maxHeight;
    return Math.min(Math.max(contentHeight + handleHeight, 200), maxHeight);
  }, [contentHeight, handleHeight, maxHeight]);

  const collapsedTranslate = useMemo(
    () => Math.max(sheetHeight - peekHeight, 0),
    [sheetHeight, peekHeight]
  );

  const [expanded, setExpanded] = useState(defaultExpanded);
  const translateY = useRef(new Animated.Value(defaultExpanded ? 0 : collapsedTranslate)).current;
  const currentTranslateY = useRef(defaultExpanded ? 0 : collapsedTranslate);
  const collapsedRef = useRef(collapsedTranslate);
  useEffect(() => { collapsedRef.current = collapsedTranslate; }, [collapsedTranslate]);

  // Never let the keyboard cover a focused input inside a collapsed sheet —
  // force back to expanded the moment the keyboard opens.
  useEffect(() => {
    if (keyboardHeight > 0) setExpanded(true);
  }, [keyboardHeight]);

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
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(_w, h) => setContentHeight(h)}
        >
          {children}
        </ScrollView>
      ) : (
        // No ScrollView wrapper at all when content manages its own
        // scrolling (e.g. a FlatList of search suggestions) — wrapping a
        // VirtualizedList in a ScrollView triggers React Native's nested-
        // list warning/breakage even with scrollEnabled={false}, since the
        // check is based on the component tree, not runtime scroll state.
        // Measured via onLayout instead of onContentSizeChange (that's a
        // ScrollView-only event) — this View sizes to its own content since
        // it isn't flexed, so onLayout reports the true natural height.
        <View
          style={[styles.content, styles.scrollContent, styles.noStretch]}
          onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
        >
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
  // Overrides content's flex:1 for the non-scrollable branch — that View
  // must size to its own natural content (so onLayout reports a true
  // measurement) rather than stretch to fill the sheet's height.
  noStretch: { flex: 0 },
  scrollContent: { paddingBottom: 32 },
});