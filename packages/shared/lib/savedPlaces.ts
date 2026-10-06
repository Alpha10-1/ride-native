import { supabase } from "./supabase";

export type SavedPlaceKind = "home" | "work" | "custom";

export type SavedPlace = {
  id: string;
  profile_id: string;
  kind: SavedPlaceKind;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  created_at: string;
  updated_at: string;
};

export type SavedPlaceInput = {
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("Not signed in.");
  return userId;
}

export async function getSavedPlaces(): Promise<SavedPlace[]> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("saved_places")
    .select("*")
    .eq("profile_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// Home and Work are singleton slots: if one already exists for this profile,
// update it in place; otherwise insert a new row.
export async function setFixedPlace(kind: "home" | "work", input: SavedPlaceInput): Promise<SavedPlace> {
  const userId = await getUserId();

  const { data: existing, error: fetchError } = await supabase
    .from("saved_places")
    .select("id")
    .eq("profile_id", userId)
    .eq("kind", kind)
    .maybeSingle();

  if (fetchError) throw fetchError;

  if (existing) {
    const { data, error } = await supabase
      .from("saved_places")
      .update({
        label: input.label,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("saved_places")
    .insert({
      profile_id: userId,
      kind,
      label: input.label,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function addCustomPlace(input: SavedPlaceInput): Promise<SavedPlace> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("saved_places")
    .insert({
      profile_id: userId,
      kind: "custom",
      label: input.label,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSavedPlace(id: string): Promise<void> {
  const { error } = await supabase.from("saved_places").delete().eq("id", id);
  if (error) throw error;
}