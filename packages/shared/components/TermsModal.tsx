import React, { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";
import { getAppContent } from "../lib/appContent";

const FALLBACK_TERMS =
  "Terms & Conditions are temporarily unavailable. Please check your connection and try again, " +
  "or contact support if this keeps happening.";

export default function TermsModal({
  visible,
  onClose,
  onAgree,
}: {
  visible: boolean;
  onClose: () => void;
  onAgree: () => void;
}) {
  const [reachedEnd, setReachedEnd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState(FALLBACK_TERMS);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    getAppContent("terms_and_conditions")
      .then((content) => {
        if (!cancelled && content) setBody(content.body);
      })
      .catch(() => {
        // keep the fallback text — never block signup on a fetch failure
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Terms & Conditions</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={COLORS.red} />
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              onScroll={({ nativeEvent }) => {
                const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                const closeToBottom =
                  layoutMeasurement.height + contentOffset.y >= contentSize.height - 24;
                if (closeToBottom) setReachedEnd(true);
              }}
              scrollEventThrottle={100}
            >
              <Text style={styles.body}>{body}</Text>
            </ScrollView>
          )}

          <Pressable
            style={[styles.agreeBtn, !reachedEnd && styles.agreeBtnDisabled]}
            disabled={!reachedEnd}
            onPress={onAgree}
          >
            <Text style={styles.agreeTxt}>
              {reachedEnd ? "I Agree" : "Scroll to read all terms"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.borderRed,
    maxHeight: "85%",
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    maxHeight: 420,
  },
  loadingWrap: {
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    color: COLORS.textDim,
    fontSize: 13,
    lineHeight: 20,
  },
  agreeBtn: {
    height: 52,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
  },
  agreeBtnDisabled: {
    backgroundColor: "rgba(255,46,46,0.3)",
  },
  agreeTxt: {
    color: "#000",
    fontWeight: "900",
    fontSize: 15,
  },
});