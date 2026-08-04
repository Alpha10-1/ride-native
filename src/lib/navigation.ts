import { router } from "expo-router";

// Fully resets navigation history before landing on `href` — use this
// (never plain router.replace) at any boundary where nothing from before
// it should ever be reachable via the back button: signing out, signing
// in, and switching between rider/driver mode.
//
// router.replace() alone only swaps the CURRENT screen for the new one —
// everything pushed onto the stack before it (e.g. driver screens like
// Requests or Active Trip from before a "Switch to Rider" tap) stays
// underneath and is still reachable by pressing back repeatedly. That's
// the exact mechanism behind "back button eventually lands me in the
// other portal" — dismissAll() first pops all the way to the root of the
// stack, then replace() swaps that root screen for the target, leaving
// the target as the only entry.
export function resetTo(href: string) {
  // dismissAll() dispatches a POP_TO_TOP-style action under the hood —
  // if the current stack is already just one screen deep (e.g. right
  // after a fresh app launch), there's nothing to pop to and React
  // Navigation logs a "not handled by any navigator" warning. It's
  // dev-only and harmless either way, but canGoBack() tells us whether
  // there's actually anything to dismiss, so we can skip the call
  // entirely rather than just swallowing the warning.
  if (router.canGoBack()) {
    router.dismissAll();
  }
  router.replace(href as any);
}