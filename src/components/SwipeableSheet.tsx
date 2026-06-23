import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { RADIUS } from "../theme/tokens";

export const SheetDraggingContext = createContext(false);
export function useSheetDragging() { return useContext(SheetDraggingContext); }

type TabKey = "home" | "work" | "recent" | "safety";

type Props = {
  children: React.ReactNode;
  handleHeight?: number;
  topGap?: number;
  maxHeight?: number;
  defaultExpanded?: boolean;
  defaultTab?: TabKey;
  onTabChange?: (tab: TabKey) => void;
};

export default function SwipeableSheet({
  children,
  handleHeight = 56,
  topGap = 160,
  maxHeight = 680,
  defaultExpanded = true,
  defaultTab = "home",
  onTabChange,
}: Props) {
  const [vh, setVh] = useState(Dimensions.get("window").height);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setVh(window.height));
    return () => sub.remove();
  }, []);

  const [contentH, setContentH] = useState(260);
  const contentHRef = useRef(contentH);

  const onContentLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h <= 0) return;
    const prev = contentHRef.current;
    if (Math.abs(h - prev) < 6) return;
    contentHRef.current = h;
    setContentH(h);
  };

  const sheetHeight = useMemo(() => {
    const desired = handleHeight + contentH;
    const capByMax = Math.min(desired, maxHeight);
    return Math.min(capByMax, Math.max(vh - 24, handleHeight));
  }, [handleHeight, contentH, maxHeight, vh]);

  const collapsedTranslate = useMemo(
    () => Math.max(sheetHeight - handleHeight, 0),
    [sheetHeight, handleHeight]
  );

  const expandedTranslate = useMemo(() => {
    const minTranslate = Math.max(topGap, 0);
    const topAtZero = vh - sheetHeight - 12;
    if (topAtZero >= minTranslate) return 0;
    const neededDown = minTranslate - topAtZero;
    return Math.min(neededDown, collapsedTranslate);
  }, [topGap, vh, sheetHeight, collapsedTranslate]);

  const [expanded, setExpanded] = useState(defaultExpanded);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const translateY = useRef(
    new Animated.Value(defaultExpanded ? expandedTranslate : collapsedTranslate)
  ).current;

  // Track current offset for pan responder
  const currentTranslateY = useRef(defaultExpanded ? expandedTranslate : collapsedTranslate);

  // Sync animated value when snap targets change
  useEffect(() => {
    const toValue = expanded ? expandedTranslate : collapsedTranslate;
    currentTranslateY.current = toValue;
    translateY.stopAnimation(() => {
      Animated.spring(translateY, {
        toValue,
        useNativeDriver: true,
        tension: 110,
        friction: 18,
      }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, collapsedTranslate, expandedTranslate]);

  // Refs so the PanResponder closure always sees the latest snap values
  const expandedTranslateRef = useRef(expandedTranslate);
  const collapsedTranslateRef = useRef(collapsedTranslate);
  useEffect(() => { expandedTranslateRef.current = expandedTranslate; }, [expandedTranslate]);
  useEffect(() => { collapsedTranslateRef.current = collapsedTranslate; }, [collapsedTranslate]);

  const [dragging, setDragging] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        Math.abs(gs.dy) > 8 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5,

      onPanResponderGrant: () => {
        setDragging(true);
        translateY.stopAnimation((val) => {
          currentTranslateY.current = val;
          translateY.setValue(val);
        });
      },

      onPanResponderMove: (_, gs) => {
        const next = currentTranslateY.current + gs.dy;
        const clamped = Math.max(
          expandedTranslateRef.current,
          Math.min(collapsedTranslateRef.current, next)
        );
        translateY.setValue(clamped);
      },

      onPanResponderRelease: (_, gs) => {
        setDragging(false);
        const velocity = gs.vy;
        const current = currentTranslateY.current + gs.dy;
        const midpoint = (expandedTranslateRef.current + collapsedTranslateRef.current) / 2;

        let shouldExpand: boolean;
        if (Math.abs(velocity) > 0.5) {
          shouldExpand = velocity < 0;
        } else {
          shouldExpand = current < midpoint;
        }

        setExpanded(shouldExpand);
        const toValue = shouldExpand ? expandedTranslateRef.current : collapsedTranslateRef.current;
        currentTranslateY.current = toValue;

        Animated.spring(translateY, {
          toValue,
          useNativeDriver: true,
          tension: 120,
          friction: 18,
          velocity,
        }).start();
      },

      onPanResponderTerminate: () => {
        setDragging(false);
      },
    })
  ).current;

  const toggle = () => setExpanded((p) => !p);

  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  const ICON_COLOR = "#ff2e2e";

  const tabs: Array<{ key: TabKey; label: string; icon: any }> = [
    { key: "safety", label: "Safety", icon: "shield-check-outline" },
    { key: "home", label: "Home", icon: "home-variant" },
    { key: "work", label: "Work", icon: "briefcase-outline" },
    { key: "recent", label: "Recent", icon: "clock-outline" },
  ];

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          height: sheetHeight,
          transform: [{ translateY }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* Handle — tappable for toggle, also covered by pan responder */}
      <Pressable
        onPress={toggle}
        style={[
          styles.handle,
          { height: handleHeight },
          Platform.OS === "web" ? ({ cursor: "pointer", touchAction: "none" } as any) : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse sheet" : "Expand sheet"}
      >
        <View style={styles.grabber} />
      </Pressable>

      <View onLayout={onContentLayout} style={styles.content}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {tabs.map((t) => {
            const active = activeTab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.tabBtn, active ? styles.tabBtnActive : null]}
              >
                <MaterialCommunityIcons name={t.icon} size={18} color={ICON_COLOR} />
                <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <SheetDraggingContext.Provider value={dragging}>
          {children}
        </SheetDraggingContext.Provider>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: RADIUS.xl,
    backgroundColor: "rgba(10,10,10,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,46,46,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.65,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
    overflow: "hidden",
  },
  handle: {
    alignItems: "center",
    justifyContent: "center",
  },
  grabber: {
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  content: {
    padding: 14,
    gap: 12,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 10,
    paddingBottom: 2,
    paddingRight: 8,
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  tabBtnActive: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,46,46,0.18)",
  },
  tabText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "600",
  },
  tabTextActive: {
    color: "rgba(255,255,255,0.95)",
  },
});