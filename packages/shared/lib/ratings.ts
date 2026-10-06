import { supabase } from "./supabase";

export type RideRating = {
  id: string;
  ride_id: string;
  rider_id: string;
  driver_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
};

export type DriverRatingSummary = {
  avg_rating: number | null;
  rating_count: number;
};

// Submits a rider's rating for a completed ride. Server-side (see
// submit_ride_rating() in the migration) re-validates ownership, ride
// status, and that this ride hasn't already been rated — this is not
// just a client-side convenience check.
export async function submitRideRating(
  rideId: string,
  stars: number,
  comment?: string | null
): Promise<RideRating> {
  const { data, error } = await supabase.rpc("submit_ride_rating", {
    ride_id_in: rideId,
    stars_in: stars,
    comment_in: comment ?? null,
  });
  if (error) throw new Error(error.message);
  return data as RideRating;
}

// Checks whether the current rider has already rated this ride — lets
// the post-trip screen show "Thanks for your feedback" instead of the
// rating form on repeat visits (e.g. navigating back to the receipt).
export async function getMyRatingForRide(rideId: string): Promise<RideRating | null> {
  const { data, error } = await supabase.rpc("get_my_rating_for_ride", { ride_id_in: rideId });
  if (error) throw new Error(error.message);
  // The RPC returns a single (possibly all-null) row rather than no row
  // when nothing's been rated yet — treat a missing id as "no rating".
  if (!data || !data.id) return null;
  return data as RideRating;
}

// A driver's own aggregate rating, read straight off their profile row.
export async function getMyDriverRatingSummary(): Promise<DriverRatingSummary> {
  const { data, error } = await supabase
    .from("profiles")
    .select("avg_rating, rating_count")
    .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .single();
  if (error) throw new Error(error.message);
  return { avg_rating: data?.avg_rating ?? null, rating_count: data?.rating_count ?? 0 };
}

// Recent feedback (stars + comment) left about the current driver —
// powers a "Ratings & Feedback" screen. RLS already restricts this to
// the calling driver's own received ratings.
export async function getMyReceivedRatings(limit = 50): Promise<RideRating[]> {
  const { data: userData } = await supabase.auth.getUser();
  const driverId = userData.user?.id;
  if (!driverId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("ride_ratings")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as RideRating[];
}
