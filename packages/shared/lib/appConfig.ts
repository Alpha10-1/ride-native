import Constants from "expo-constants";

// Which of the two apps this build is. Each app declares it in its own
// app.json (apps/rider/app.json, apps/driver/app.json) under
// expo.extra.appRole, so it's baked in at build time and readable
// synchronously from anywhere in this shared package.
//
// Role-specific behavior in shared code should key off APP_ROLE, never
// profiles.role: role is now fixed per app, while profiles.role only
// records how the account originally signed up (a rider who later applied
// to drive still has role = 'rider', which is why the old single app showed
// rider wording on driver screens for those accounts).
export type AppRole = "rider" | "driver";

type CounterpartConfig = {
  // Display name of the other app, used in copy ("Open Ride Driver").
  name: string;
  // URL scheme the other app registers (its app.json `scheme`).
  scheme: string;
  // Used to build a Play Store link when the other app isn't installed.
  androidPackage?: string;
  // Full App Store URL — only known once the app has been published.
  iosAppStoreUrl?: string;
};

type AppExtra = {
  appRole?: string;
  counterpart?: CounterpartConfig;
};

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

if (__DEV__ && extra.appRole !== "rider" && extra.appRole !== "driver") {
  console.warn(
    `[appConfig] expo.extra.appRole is ${JSON.stringify(extra.appRole)} — expected "rider" or "driver". ` +
      `Falling back to "rider". Check this app's app.json.`
  );
}

export const APP_ROLE: AppRole = extra.appRole === "driver" ? "driver" : "rider";
export const IS_DRIVER_APP = APP_ROLE === "driver";

export const APP_NAME: string = Constants.expoConfig?.name ?? (IS_DRIVER_APP ? "Ride Driver" : "Ride");

// Landing screen for a signed-in user of this app.
export const APP_HOME = IS_DRIVER_APP ? "/(driver)/home" : "/(rider)/home";

// Builds a route inside this app's own route group, e.g.
// appRoute("support-chat") -> "/(driver)/support-chat" in the driver app.
// Shared screens use this instead of picking "(rider)" vs "(driver)" from
// the profile, since each app only contains its own group.
export function appRoute(screen: string): string {
  return `/(${APP_ROLE})/${screen.replace(/^\//, "")}`;
}

const rawScheme = Constants.expoConfig?.scheme;
export const APP_SCHEME: string =
  (Array.isArray(rawScheme) ? rawScheme[0] : rawScheme) ?? (IS_DRIVER_APP ? "ridedriver" : "ridenative");

// Deep link back into this app — used for Supabase auth email links
// (password reset, email confirmation). Each app has its own scheme, so a
// link requested from the driver app reopens the driver app.
export function appDeepLink(path: string): string {
  return `${APP_SCHEME}://${path.replace(/^\//, "")}`;
}

export const COUNTERPART: CounterpartConfig =
  extra.counterpart ??
  (IS_DRIVER_APP
    ? { name: "Ride", scheme: "ridenative", androidPackage: "com.alpha_lubisi.ridenative" }
    : { name: "Ride Driver", scheme: "ridedriver", androidPackage: "com.alpha_lubisi.ridedriver" });
