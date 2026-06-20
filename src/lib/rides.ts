import { supabase } from "./supabase";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string;

export type RideStatus =
  | "requested"
  | "accepted"
  | "driver_en_route"
  | "driver_arrived"
  | "in_progress"
  | "completed"
  | "cancelled";

export type Ride = {
  id: string;
  rider_id: string;
  driver_id: string | null;
  status: RideStatus;
  pickup_label: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_label: string;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  estimated_distance_km: number | null;
  estimated_duration_min: number | null;
  actual_distance_km: number | null;
  actual_duration_min: number | null;
  demand_multiplier: number;
  estimated_fare_cents: number | null;
  final_fare_cents: number | null;
  cancellation_fee_cents: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  requested_at: string;
  accepted_at: string | null;
  driver_arrived_at: string | null;
  trip_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: "rider" | "driver" | null;
};

export type RouteResult = {
  distanceKm: number;
  durationMin: number;
  geometry: any;
};

// ============================================
// MAPBOX DIRECTIONS
// ============================================
export async function getRoute(
  from: [number, number],
  to: [number, number]
): Promise<RouteResult> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions API error (${res.status})`);

  const json = await res.json();
  const route = json?.routes?.[0];
  if (!route) throw new Error("No route found between these points.");

  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    geometry: route.geometry,
  };
}

// ============================================
// ACTIVE RIDE QUERIES
// ============================================
export async function getActiveRideForRider(): Promise<Ride | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("rider_id", userId)
    .not("status", "in", '("completed","cancelled")')
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getActiveRideForDriver(): Promise<Ride | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", userId)
    .not("status", "in", '("completed","cancelled")')
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getPendingRideRequests(): Promise<Ride[]> {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("status", "requested")
    .order("requested_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getRideById(rideId: string): Promise<Ride | null> {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getRideHistory(limit = 20): Promise<Ride[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
    .in("status", ["completed", "cancelled"])
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ============================================
// RIDE ACTION RPCs
// ============================================
export async function requestRide(params: {
  pickupLabel: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationLabel: string;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
}): Promise<Ride> {
  const { data, error } = await supabase.rpc("request_ride", {
    pickup_label_in: params.pickupLabel,
    pickup_address_in: params.pickupAddress,
    pickup_lat_in: params.pickupLat,
    pickup_lng_in: params.pickupLng,
    destination_label_in: params.destinationLabel,
    destination_address_in: params.destinationAddress,
    destination_lat_in: params.destinationLat,
    destination_lng_in: params.destinationLng,
    estimated_distance_km_in: params.estimatedDistanceKm,
    estimated_duration_min_in: params.estimatedDurationMin,
  });
  if (error) throw error;
  return data as Ride;
}

export async function acceptRide(rideId: string): Promise<Ride> {
  const { data, error } = await supabase.rpc("accept_ride", {
    ride_id_in: rideId,
  });
  if (error) throw error;
  return data as Ride;
}

export async function advanceRideStatus(rideId: string): Promise<Ride> {
  const { data, error } = await supabase.rpc("advance_ride_status", {
    ride_id_in: rideId,
  });
  if (error) throw error;
  return data as Ride;
}

export async function completeRide(
  rideId: string,
  actualDistanceKm: number,
  actualDurationMin: number
): Promise<Ride> {
  const { data, error } = await supabase.rpc("complete_ride", {
    ride_id_in: rideId,
    actual_distance_km_in: actualDistanceKm,
    actual_duration_min_in: actualDurationMin,
  });
  if (error) throw error;
  return data as Ride;
}

export async function cancelRide(rideId: string): Promise<Ride> {
  const { data, error } = await supabase.rpc("cancel_ride", {
    ride_id_in: rideId,
  });
  if (error) throw error;
  return data as Ride;
}

export async function updateDriverLocation(
  rideId: string,
  lat: number,
  lng: number
): Promise<void> {
  const { error } = await supabase.rpc("update_driver_location", {
    ride_id_in: rideId,
    lat_in: lat,
    lng_in: lng,
  });
  if (error) throw error;
}

// ============================================
// REALTIME SUBSCRIPTION
// ============================================
export function subscribeToRide(
  rideId: string,
  onUpdate: (ride: Ride) => void
) {
  const channel = supabase
    .channel(`ride:${rideId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rides",
        filter: `id=eq.${rideId}`,
      },
      (payload) => {
        onUpdate(payload.new as Ride);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================
// HELPERS
// ============================================
export function formatFare(cents: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

export function demandLabel(multiplier: number): string {
  if (multiplier >= 1.4) return "Very Busy";
  if (multiplier >= 1.3) return "Busy";
  return "Normal";
}

export function statusLabel(status: RideStatus): string {
  switch (status) {
    case "requested": return "Finding your driver...";
    case "accepted": return "Driver accepted";
    case "driver_en_route": return "Driver on the way";
    case "driver_arrived": return "Driver has arrived";
    case "in_progress": return "Trip in progress";
    case "completed": return "Trip completed";
    case "cancelled": return "Trip cancelled";
  }
}