import React, { useEffect, useRef, useState } from "react";
import { Text, StyleSheet, View, ActivityIndicator } from "react-native";
import { resetTo } from "../lib/navigation";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import SideMenuDrawer from "../components/SideMenuDrawer";
import ChatThread, { ChatBubble } from "../components/ChatThread";
import { COLORS } from "../theme/tokens";
import { getCurrentProfile } from "../lib/auth";
import {
  SupportMessage, getSupportMessages, sendSupportMessage, subscribeToSupportMessages,
} from "../lib/chat";

// The actual support conversation thread (rider/driver <-> admin), scoped
// to the signed-in user. This is distinct from SupportScreen.tsx, which is
// the "Help & Support" landing page with contact options that links here.
export default function SupportChatScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          resetTo("/auth/login");
          return;
        }
        const msgs = await getSupportMessages();

        if (cancelled) return;
        setRole(profile.role);
        setMyId(profile.id);
        setMessages(msgs);

        unsubscribeRef.current = subscribeToSupportMessages(profile.id, (m) => {
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load conversation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
    };
  }, []);

  const bubbles: ChatBubble[] = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    isMine: m.sender_role === "user",
    senderLabel: m.sender_role === "admin" ? "Support" : undefined,
  }));

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Support Chat" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Support Chat" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
        placeholder="Message support..."
        emptyStateText="No messages yet. Tell us what's going on and we'll get back to you."
      />
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: "rgba(255,90,90,0.95)", fontWeight: "700", paddingHorizontal: 16, paddingTop: 8 },
});
