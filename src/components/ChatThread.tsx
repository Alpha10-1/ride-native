import React, { useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, SPACE, RADIUS } from "../theme/tokens";

export type ChatBubble = {
  id: string;
  body: string;
  createdAt: string;
  isMine: boolean;
  senderLabel?: string; // e.g. "Admin" — shown above bubbles that aren't "mine"
};

type Props = {
  bubbles: ChatBubble[];
  onSend: (body: string) => Promise<void> | void;
  disabled?: boolean;
  disabledMessage?: string;
  placeholder?: string;
  emptyStateText?: string;
  loading?: boolean;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatThread({
  bubbles,
  onSend,
  disabled,
  disabledMessage,
  placeholder = "Type a message...",
  emptyStateText = "No messages yet. Say hello!",
  loading,
}: Props) {
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const listRef = useRef<FlatList>(null);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText("");
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={bubbles}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: SPACE.md, gap: 8, flexGrow: 1 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.centerFill}>
              <Text style={styles.emptyTxt}>{emptyStateText}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.isMine && { justifyContent: "flex-end" }]}>
              <View style={[styles.bubble, item.isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {!item.isMine && item.senderLabel ? (
                  <Text style={styles.senderLabel}>{item.senderLabel}</Text>
                ) : null}
                <Text style={[styles.bubbleTxt, item.isMine && { color: "#000" }]}>{item.body}</Text>
                <Text style={[styles.bubbleTime, item.isMine && { color: "rgba(0,0,0,0.5)" }]}>
                  {formatTime(item.createdAt)}
                </Text>
              </View>
            </View>
          )}
        />
      )}

      {disabled ? (
        <View style={styles.disabledBar}>
          <Ionicons name="lock-closed-outline" size={14} color={COLORS.textDim} />
          <Text style={styles.disabledTxt}>{disabledMessage ?? "This conversation is closed."}</Text>
        </View>
      ) : (
        <View style={styles.inputBar}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textFaint}
            style={styles.input}
            multiline
            maxLength={1000}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              (!text.trim() || sending) && { opacity: 0.4 },
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
            disabled={!text.trim() || sending}
            onPress={handleSend}
          >
            {sending ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#000" />
            )}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyTxt: { color: COLORS.textFaint, fontSize: 13 },
  bubbleRow: { flexDirection: "row" },
  bubble: {
    maxWidth: "78%",
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleTheirs: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderBottomLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: COLORS.red,
    borderBottomRightRadius: 4,
  },
  senderLabel: {
    color: COLORS.red,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  bubbleTxt: { color: COLORS.text, fontSize: 14, lineHeight: 19 },
  bubbleTime: { color: COLORS.textFaint, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: SPACE.md, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  input: {
    flex: 1, maxHeight: 100, color: COLORS.text, fontSize: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 10,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.red, alignItems: "center", justifyContent: "center",
  },
  disabledBar: {
    flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center",
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  disabledTxt: { color: COLORS.textDim, fontSize: 12 },
});