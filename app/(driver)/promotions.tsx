// Shared implementation lives in src/screens/PromotionsScreen.tsx
// (role-aware internally, filtered by applies_to_role server-side). Both
// (rider) and (driver) route files import it directly — deliberately NOT
// re-exporting from each other's route file, since two route-group files
// sharing the same leaf name both resolve to the same URL path and can be
// misregistered.
export { default } from "../../src/screens/PromotionsScreen";