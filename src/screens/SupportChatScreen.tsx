import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import SideMenuDrawer from "../components/SideMenuDrawer";
import ChatThread, { ChatBubble } from "../components/ChatThread";
import { COLORS } from "../theme/tokens";
import { getCurrentProfile } from "../lib/auth";
import {
  SupportMessage, getSupportMessages, sendSupportMessage, subscribeToSupportMessages,
} from "../lib/chat";

export default function SupportChatScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          router.replace("/auth/login");
          return;
        }
        const msgs = await getSupportMessages();
        if (cancelled) return;
        setRole(profile.role);
        setMyId(profile.id);
        setMessages(msgs);

        unsubscribe = subscribeToSupportMessages(profile.id, (m) => {
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const bubbles: ChatBubble[] = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    isMine: m.sender_role === "user",
    senderLabel: m.sender_role === "admin" ? "Support" : undefined,
  }));

  return (
    <Screen>
      <RiderHeader subtitle="Support Chat" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      ) : (
        <ChatThread
          bubbles={bubbles}
          onSend={async (body) => {
            const optimistic: SupportMessage = {
              id: `pending-${Date.now()}`,
              user_id: myId ?? "",
              sender_id: myId ?? "",
              sender_role: "user",
              body,
              created_at: new Date().toISOString(),
              read_at: null,
            };
            setMessages((prev) => [...prev, optimistic]);
            try {
              const saved = await sendSupportMessage(body);
              setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
            } catch {
              setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
            }
          }}
          placeholder="Message our support team..."
          emptyStateText="Tell us what's going on — we usually reply within a few hours."
        />
      )}
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
});