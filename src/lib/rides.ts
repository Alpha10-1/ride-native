import { supabase } from "./supabase";
import { decodePolyline } from "./polyline";
import { fetchWithTimeout } from "./geocoding";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

export type RideTier = "economy" | "comfort" | "xl";

export const TIER_CONFIG: Record<RideTier, { label: string; multiplier: number; description: string; icon: string }> = {
  economy:  { label: "Economy",  multiplier: 1.0, description: "Affordable everyday rides", icon: "car-outline" },
  comfort:  { label: "Comfort",  multiplier: 1.5, description: "Newer cars, more comfort",  icon: "car-sport-outline" },
  xl:       { label: "XL",       multiplier: 2.0, description: "Larger vehicle, more space", icon: "bus-outline" },
};

export type RideStatus =
  | "scheduled"
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
  ride_tier: RideTier;
  estimated_fare_cents: number | null;
  final_fare_cents: number | null;
  rider_proposed_fare_cents: number | null;
  cancellation_fee_cents: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  scheduled_for: string | null;
  requested_at: string;
  accepted_at: string | null;
  driver_arrived_at: string | null;
  trip_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: "rider" | "driver" | null;
  payment_method: "wallet" | "card" | "cash";
  payment_status: "unpaid" | "pending" | "reserved" | "paid" | "failed";
  payment_reference: string | null;
  card_reservation_status: "none" | "pending" | "reserved" | "captured" | "released" | "failed";
  card_reservation_reference: string | null;
  card_reservation_amount_cents: number | null;
};

export type RouteResult = {
  distanceKm: number;
  durationMin: number;
  geometry: any;
};

export type RideStop = {
  id: string;
  ride_id: string;
  sequence: number;
  label: string;
  address: string;
  lat: number;
  lng: number;
  reached_at: string | null;
};

// ============================================
// GOOGLE DIRECTIONS
// ============================================
// Accepts 2+ waypoints in visit order: [pickup, ...stops, destination].
// Backward compatible with the old two-point call — just pass [from, to].
// geometry keeps the same GeoJSON-style shape ({ type: "LineString",
// coordinates: [lng, lat][] }) the rest of the app already expects, so
// screens only need to change how they *render* it (react-native-maps
// Polyline instead of Mapbox ShapeSource), not how they fetch/store it.
export async function getRoute(waypoints: [number, number][]): Promise<RouteResult> {
  if (waypoints.length < 2) throw new Error("getRoute needs at least 2 points.");

  const [originLng, originLat] = waypoints[0];
  const [destLng, destLat] = waypoints[waypoints.length - 1];
  const via = waypoints.slice(1, -1);

  const params = new URLSearchParams({
    origin: `${originLat},${originLng}`,
    destination: `${destLat},${destLng}`,
    key: GOOGLE_MAPS_API_KEY,
  });
  if (via.length > 0) {
    params.set("waypoints", via.map(([lng, lat]) => `${lat},${lng}`).join("|"));
  }

  // fetchWithTimeout (not plain fetch) so a stalled request rejects
  // instead of hanging — the caller (route refinement in the booking
  // flow) already falls back to the straight-line estimate on any error,
  // but only if this actually settles rather than hanging forever.
  const res = await fetchWithTimeout(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
    undefined,
    10_000
  );
  if (!res.ok) throw new Error(`Directions API error (${res.status})`);

  const json = await res.json();
  if (json.status !== "OK" || !json.routes?.[0]) {
    throw new Error(json.error_message || `No route found (${json.status})`);
  }

  const route = json.routes[0];
  const legs = route.legs ?? [];
  const distanceM = legs.reduce((sum: number, leg: any) => sum + (leg.distance?.value ?? 0), 0);
  const durationS = legs.reduce((sum: number, leg: any) => sum + (leg.duration?.value ?? 0), 0);

  const points = decodePolyline(route.overview_polyline?.points ?? "");
  const coordinates: [number, number][] = points.map((p) => [p.lng, p.lat]);

  return {
    distanceKm: distanceM / 1000,
    durationMin: durationS / 60,
    geometry: { type: "LineString", coordinates },
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
    .not("status", "in", '("completed","cancelled","scheduled")')
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

export async function activateDueScheduledRides(): Promise<void> {
  // Best-effort — there's no server-side cron in this project, so any
  // client polling for requests nudges due scheduled rides into
  // 'requested'. Safe to call often; it only touches rides whose time has
  // actually come.
  try {
    await supabase.rpc("activate_due_scheduled_rides");
  } catch {
    // Non-critical — worst case a scheduled ride activates a poll cycle late.
  }
}

export async function getPendingRideRequests(): Promise<Ride[]> {
  await activateDueScheduledRides();

  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;

  let query = supabase
    .from("rides")
    .select("*")
    .eq("status", "requested")
    .order("requested_at", { ascending: true });

  // A rider can never see/accept their own request, even if they switch
  // their own account into driver mode.
  if (userId) query = query.neq("rider_id", userId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getMyScheduledRides(): Promise<Ride[]> {
  await activateDueScheduledRides();

  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("rider_id", userId)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true });
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

export type DriverContactInfo = {
  first_name: string;
  last_name: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  license_plate: string | null;
  avg_rating: number | null;
  rating_count: number;
};

// Minimal driver info a rider needs once matched — enough to recognize
// the car curbside and see who's driving, not the driver's full profile
// (no email/cellphone/license number/banking details). Same direct-select
// pattern as getProfileName() in negotiation.ts, just a wider field list.
export async function getDriverContactInfo(driverId: string): Promise<DriverContactInfo | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, vehicle_make, vehicle_model, license_plate, avg_rating, rating_count")
    .eq("id", driverId)
    .single();
  if (error || !data) return null;
  return data as DriverContactInfo;
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

export type ProfileStats = { tripCount: number; totalCents: number };

export async function getProfileStats(): Promise<ProfileStats> {
  const { data, error } = await supabase.rpc("get_profile_stats");
  if (error) throw error;
  const row = data?.[0];
  return { tripCount: Number(row?.trip_count ?? 0), totalCents: Number(row?.total_cents ?? 0) };
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
  rideTier: RideTier;
  stops?: { label: string; address: string; lat: number; lng: number }[];
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
    ride_tier_in: params.rideTier,
    stops_in: params.stops ?? [],
  });
  if (error) throw error;
  return data as Ride;
}

export async function requestScheduledRide(params: {
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
  rideTier: RideTier;
  scheduledFor: Date;
  stops?: { label: string; address: string; lat: number; lng: number }[];
}): Promise<Ride> {
  const { data, error } = await supabase.rpc("request_scheduled_ride", {
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
    ride_tier_in: params.rideTier,
    scheduled_for_in: params.scheduledFor.toISOString(),
    stops_in: params.stops ?? [],
  });
  if (error) throw error;
  return data as Ride;
}

export async function getRideStops(rideId: string): Promise<RideStop[]> {
  const { data, error } = await supabase
    .from("ride_stops")
    .select("*")
    .eq("ride_id", rideId)
    .order("sequence", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RideStop[];
}

export async function markStopReached(rideId: string, stopId: string): Promise<RideStop> {
  const { data, error } = await supabase.rpc("mark_stop_reached", {
    ride_id_in: rideId,
    stop_id_in: stopId,
  });
  if (error) throw error;
  return data as RideStop;
}

// The lowest amount a rider is allowed to propose: 50% of the estimated fare.
// Mirrors the check enforced server-side in propose_rider_fare / the
// ride_offers trigger — kept here so the UI can validate before it even
// hits the network.
export function minRiderOfferCents(estimatedFareCents: number): number {
  return Math.ceil(estimatedFareCents * 0.5);
}

// Sets/updates the rider's broadcast fare proposal on a still-pending ride.
// Any driver polling getPendingRideRequests can see this and either accept
// it or counter — this is the only way a negotiation on a ride can start.
export async function proposeRiderFare(rideId: string, amountCents: number): Promise<Ride> {
  const { data, error } = await supabase.rpc("propose_rider_fare", {
    ride_id_in: rideId,
    amount_cents_in: Math.round(amountCents),
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

export function subscribeToRideStops(
  rideId: string,
  onUpdate: (stop: RideStop) => void
) {
  const channel = supabase
    .channel(`ride-stops:${rideId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "ride_stops", filter: `ride_id=eq.${rideId}` },
      (payload) => onUpdate(payload.new as RideStop)
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
    case "scheduled": return "Scheduled";
    case "requested": return "Finding your driver...";
    case "accepted": return "Driver accepted";
    case "driver_en_route": return "Driver on the way";
    case "driver_arrived": return "Driver has arrived";
    case "in_progress": return "Trip in progress";
    case "completed": return "Trip completed";
    case "cancelled": return "Trip cancelled";
  }
}

// ============================================
// TRIP SLIPS
// ============================================
export type TripSlip = {
  id: string;
  ride_id: string;
  rider_id: string;
  driver_id: string | null;
  rider_name: string;
  driver_name: string | null;
  driver_username: string | null;
  ride_tier: RideTier;
  pickup_address: string;
  destination_address: string;
  actual_distance_km: number | null;
  actual_duration_min: number | null;
  base_fare_cents: number | null;
  tier_multiplier: number | null;
  demand_multiplier: number | null;
  booking_fee_cents: number | null;
  final_fare_cents: number | null;
  currency: string;
  trip_status: string;
  cancellation_fee_cents: number | null;
  cancelled_by: string | null;
  requested_at: string | null;
  trip_started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export async function getTripSlip(rideId: string): Promise<TripSlip | null> {
  const { data, error } = await supabase
    .from("trip_slips")
    .select("*")
    .eq("ride_id", rideId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getTripSlipHistory(limit = 20): Promise<TripSlip[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("trip_slips")
    .select("*")
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}