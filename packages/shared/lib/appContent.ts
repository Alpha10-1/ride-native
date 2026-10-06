import { supabase } from "./supabase";

export type AppContent = {
  key: string;
  title: string;
  body: string;
  updated_at: string;
};

export async function getAppContent(key: string): Promise<AppContent | null> {
  const { data, error } = await supabase
    .from("app_content")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data;
}