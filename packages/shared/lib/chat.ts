import { supabase } from "./supabase";

export type RideMessage = {
  id: string;
  ride_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type SupportMessage = {
  id: string;
  user_id: string;
  sender_id: string;
  sender_role: "user" | "admin";
  body: string;
  created_at: string;
  read_at: string | null;
};

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Not signed in.");
  return id;
}

// ============================================
// RIDE CHAT (rider <-> driver, scoped to a ride)
// ============================================

export async function getRideMessages(rideId: string): Promise<RideMessage[]> {
  const { data, error } = await supabase
    .from("ride_messages")
    .select("*")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RideMessage[];
}

export async function sendRideMessage(rideId: string, body: string): Promise<RideMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message can't be empty.");
  const senderId = await currentUserId();

  const { data, error } = await supabase
    .from("ride_messages")
    .insert({ ride_id: rideId, sender_id: senderId, body: trimmed })
    .select()
    .single();
  if (error) throw error;
  return data as RideMessage;
}

export function subscribeToRideMessages(
  rideId: string,
  onMessage: (message: RideMessage) => void
) {
  const channel = supabase
    .channel(`ride-messages-${rideId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "ride_messages", filter: `ride_id=eq.${rideId}` },
      (payload) => onMessage(payload.new as RideMessage)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Looks up the other participant's display name for the chat header.
export async function getOtherPartyName(riderId: string, driverId: string | null): Promise<string> {
  const myId = await currentUserId();
  const otherId = myId === riderId ? driverId : riderId;
  if (!otherId) return "Driver";

  const { data, error } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", otherId)
    .single();
  if (error || !data) return "there";
  return `${data.first_name} ${data.last_name}`.trim();
}

// ============================================
// SUPPORT CHAT (driver/rider <-> admin)
// ============================================

export async function getSupportMessages(): Promise<SupportMessage[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("support_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SupportMessage[];
}

export async function sendSupportMessage(body: string): Promise<SupportMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message can't be empty.");
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("support_messages")
    .insert({ user_id: userId, sender_id: userId, sender_role: "user", body: trimmed })
    .select()
    .single();
  if (error) throw error;
  return data as SupportMessage;
}

export function subscribeToSupportMessages(
  userId: string,
  onMessage: (message: SupportMessage) => void
) {
  const channel = supabase
    .channel(`support-messages-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "support_messages", filter: `user_id=eq.${userId}` },
      (payload) => onMessage(payload.new as SupportMessage)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}