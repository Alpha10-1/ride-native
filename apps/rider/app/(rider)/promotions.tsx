// Shared implementation lives in packages/shared/screens/PromotionsScreen.tsx
// (role-aware internally via APP_ROLE, filtered by applies_to_role
// server-side). The rider and driver apps each have their own route file
// re-exporting it, like this one.
export { default } from "@ride/shared/screens/PromotionsScreen";