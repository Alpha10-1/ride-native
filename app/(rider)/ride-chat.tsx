import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import ChatThread, { ChatBubble } from "../../src/components/ChatThread";
import { COLORS } from "../../src/theme/tokens";
import { getCurrentProfile } from "../../src/lib/auth";
import { getRideById, Ride } from "../../src/lib/rides";
import {
  RideMessage, getRideMessages, sendRideMessage, subscribeToRideMessages, getOtherPartyName,
} from "../../src/lib/chat";

export default function RideChatScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [myId, setMyId] = useState<string | null>(null);
  const [ride, setRide] = useState<Ride | null>(null);
  const [otherName, setOtherName] = useState("");
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          router.replace("/auth/login");
          return;
        }
        const r = await getRideById(rideId);
        const msgs = await getRideMessages(rideId);
        const name = await getOtherPartyName(r.rider_id, r.driver_id);

        if (cancelled) return;
        setRole(profile.role);
        setMyId(profile.id);
        setRide(r);
        setOtherName(name);
        setMessages(msgs);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load conversation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubscribe = subscribeToRideMessages(rideId, (m) => {
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rideId]);

  const bubbles: ChatBubble[] = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    isMine: m.sender_id === myId,
  }));

  const isActive = ride && ride.status !== "completed" && ride.status !== "cancelled";

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Chat" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader
        subtitle={otherName ? `Chat with ${otherName}` : "Chat"}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ChatThread
        bubbles={bubbles}
        onSend={async (body) => {
          if (!rideId) return;
          const optimistic: RideMessage = {
            id: `pending-${Date.now()}`,
            ride_id: rideId,
            sender_id: myId ?? "",
            body,
            created_at: new Date().toISOString(),
            read_at: null,
          };
          setMessages((prev) => [...prev, optimistic]);
          try {
            const saved = await sendRideMessage(rideId, body);
            setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
          } catch {
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
          }
        }}
        disabled={!isActive}
        disabledMessage="This trip has ended — messaging is now closed."
        placeholder={`Message ${otherName || (role === "rider" ? "your driver" : "your rider")}...`}
        emptyStateText="No messages yet. Say hello!"
      />
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: "rgba(255,90,90,0.95)", fontWeight: "700", paddingHorizontal: 16, paddingTop: 8 },
});