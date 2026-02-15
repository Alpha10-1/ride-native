import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { RADIUS } from "../theme/tokens";

type TabKey = "home" | "work" | "recent" | "safety";

type Props = {
  children: React.ReactNode;

  /** Height of the visible handle area when collapsed */
  handleHeight?: number;

  /** Extra breathing room from top when expanded (prevents covering whole screen) */
  topGap?: number;

  /** Hard cap so sheet never grows too tall (even if content is huge) */
  maxHeight?: number;

  /** Start expanded on first load */
  defaultExpanded?: boolean;

  /** Optional: start on a specific tab */
  defaultTab?: TabKey;

  /** Optional: get notified when tab changes */
  onTabChange?: (tab: TabKey) => void;
};

export default function SwipeableSheet({
  children,
  handleHeight = 56,
  topGap = 160,
  maxHeight = 680,
  defaultExpanded = true, // ✅ sheet should be up already
  defaultTab = "home",
  onTabChange,
}: Props) {
  const [vh, setVh] = useState(Dimensions.get("window").height);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setVh(window.height));
    return () => sub.remove();
  }, []);

  // Measure content height (everything below the handle)
  const [contentH, setContentH] = useState(260);
  const onContentLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h > 0 && h !== contentH) setContentH(h);
  };

  // Total sheet height should fit content, but not exceed maxHeight or screen space
  const sheetHeight = useMemo(() => {
    const desired = handleHeight + contentH;
    const capByMax = Math.min(desired, maxHeight);
    const capByScreen = Math.min(capByMax, Math.max(vh - 24, handleHeight));
    return capByScreen;
  }, [handleHeight, contentH, maxHeight, vh]);

  // Collapsed: only handle visible => translate down by (sheetHeight - handleHeight)
  const collapsedTranslate = useMemo(
    () => Math.max(sheetHeight - handleHeight, 0),
    [sheetHeight, handleHeight]
  );

  // Expanded: don’t go to top; stop at a "topGap"
  const expandedTranslate = useMemo(() => {
    const minTranslate = Math.max(topGap, 0);

    const topAtZero = vh - sheetHeight - 12;
    if (topAtZero >= minTranslate) return 0;

    const neededDown = minTranslate - topAtZero;
    return Math.min(neededDown, collapsedTranslate);
  }, [topGap, vh, sheetHeight, collapsedTranslate]);

  const [expanded, setExpanded] = useState(defaultExpanded);

  // ✅ Start at correct position immediately
  const translateY = useRef(
    new Animated.Value(defaultExpanded ? expandedTranslate : collapsedTranslate)
  ).current;

  useEffect(() => {
    // Keep in sync when content/resize changes
    Animated.spring(translateY, {
      toValue: expanded ? expandedTranslate : collapsedTranslate,
      useNativeDriver: true,
      tension: 110,
      friction: 18,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedTranslate, expandedTranslate]);

  const snapTo = (toValue: number) => {
    Animated.spring(translateY, {
      toValue,
      useNativeDriver: true,
      tension: 110,
      friction: 18,
    }).start();
  };

  const setExpandState = (next: boolean) => {
    setExpanded(next);
    snapTo(next ? expandedTranslate : collapsedTranslate);
  };

  const toggle = () => setExpandState(!expanded);

  // ---------------- Tabs ----------------
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  const ICON_COLOR = "#ff2e2e";

  const tabs: Array<{ key: TabKey; label: string; icon: any }> = [
    { key: "home", label: "Home", icon: "home-variant" },
    { key: "work", label: "Work", icon: "briefcase-outline" },
    { key: "recent", label: "Recent", icon: "clock-outline" },
    { key: "safety", label: "Safety", icon: "shield-check-outline" },
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
    >
      {/* Handle: click/tap toggles */}
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

      {/* Content measured here */}
      <View onLayout={onContentLayout} style={styles.content}>
        {/* Tabs row */}
        <View style={styles.tabsRow}>
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
        </View>

        {children}
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
