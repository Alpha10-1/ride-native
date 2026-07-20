import { supabase } from "./supabase";

export type OfferProposer = "rider" | "driver";
export type OfferStatus = "pending" | "accepted" | "rejected" | "withdrawn";

export type RideOffer = {
  id: string;
  ride_id: string;
  driver_id: string;
  amount_cents: number;
  proposed_by: OfferProposer;
  status: OfferStatus;
  created_at: string;
};

export type OfferThread = { driverId: string; offers: RideOffer[]; latest: RideOffer };

export async function getRideOffers(rideId: string): Promise<RideOffer[]> {
  const { data, error } = await supabase
    .from("ride_offers")
    .select("*")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RideOffer[];
}

// driverId is required when a rider is countering an existing thread;
// omit it when a driver is starting or continuing their own thread.
export async function proposeOffer(
  rideId: string,
  amountCents: number,
  driverId?: string
): Promise<RideOffer> {
  const { data, error } = await supabase.rpc("propose_ride_offer", {
    ride_id_in: rideId,
    amount_cents_in: Math.round(amountCents),
    driver_id_in: driverId ?? null,
  });
  if (error) throw error;
  return data as RideOffer;
}

export async function respondToOffer(offerId: string, approve: boolean): Promise<RideOffer> {
  const { data, error } = await supabase.rpc("respond_to_ride_offer", {
    offer_id_in: offerId,
    approve_in: approve,
  });
  if (error) throw error;
  return data as RideOffer;
}

export function subscribeToRideOffers(rideId: string, onChange: (offer: RideOffer) => void) {
  const channel = supabase
    .channel(`ride-offers-${rideId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "ride_offers", filter: `ride_id=eq.${rideId}` },
      (payload) => onChange(payload.new as RideOffer)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "ride_offers", filter: `ride_id=eq.${rideId}` },
      (payload) => onChange(payload.new as RideOffer)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Flattens the append-only offer log into one thread per driver.
export function groupOffersByDriver(offers: RideOffer[]): OfferThread[] {
  const map = new Map<string, RideOffer[]>();
  for (const o of offers) {
    const arr = map.get(o.driver_id) ?? [];
    arr.push(o);
    map.set(o.driver_id, arr);
  }
  return Array.from(map.entries()).map(([driverId, list]) => ({
    driverId,
    offers: list,
    latest: list[list.length - 1],
  }));
}

export async function getProfileName(profileId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", profileId)
    .single();
  if (error || !data) return "Driver";
  return `${data.first_name} ${data.last_name}`.trim();
}