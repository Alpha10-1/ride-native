import { supabase } from "./supabase";

// Keep this in sync with test_mode_capability_keys() in
// 20260804120000_driver_test_mode.sql — this is just the human-readable
// side (labels for the banner/UI), the DB is the source of truth for
// which keys are actually valid.
export type TestModeCapability =
  | "go_online"
  | "accept_scheduled_rides"
  | "view_earnings"
  | "download_statements"
  | "chat_support"
  | "chat_riders"
  | "update_profile"
  | "upload_documents"
  | "manage_subscription"
  | "receive_promotions";

export const TEST_MODE_CAPABILITY_LABELS: Record<TestModeCapability, string> = {
  go_online: "Go online / accept ride requests",
  accept_scheduled_rides: "Accept scheduled rides",
  view_earnings: "View wallet & earnings",
  download_statements: "Download statements",
  chat_support: "Contact support",
  chat_riders: "Chat with riders",
  update_profile: "Update profile details/photo",
  upload_documents: "Upload verification documents",
  manage_subscription: "Manage subscription",
  receive_promotions: "View promotions",
};

export type TestModeStatus = {
  testMode: boolean;
  permissions: Partial<Record<TestModeCapability, boolean>>;
};

export async function getMyTestModeStatus(): Promise<TestModeStatus> {
  const { data, error } = await supabase.rpc("get_my_test_mode_status").single();
  if (error) throw error;
  const row = data as any;
  return {
    testMode: !!row.test_mode,
    permissions: row.permissions ?? {},
  };
}

// Convenience check — mirrors driver_has_test_capability()'s logic
// client-side (unrestricted whenever test mode is off) so screens don't
// all need to re-derive this themselves.
export function isCapabilityAllowed(status: TestModeStatus, capability: TestModeCapability): boolean {
  if (!status.testMode) return true;
  return !!status.permissions[capability];
}

// A restriction message thrown by go_online_test_checked (via
// setDriverOnlineChecked) is prefixed this way — use this to show a
// distinct "this is a test-mode restriction" message instead of a
// generic error.
export function isTestModeRestrictionError(error: unknown): boolean {
  const message = (error as any)?.message ?? String(error ?? "");
  return message.includes("TEST_MODE_RESTRICTED");
}
