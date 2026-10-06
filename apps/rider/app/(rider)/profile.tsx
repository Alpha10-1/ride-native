// Shared implementation lives in packages/shared/screens/ProfileScreen.tsx
// (role-aware internally via APP_ROLE, which each app fixes in its own
// app.json — see packages/shared/lib/appConfig.ts). The rider and driver
// apps each have their own route file re-exporting it, like this one.
export { default } from "@ride/shared/screens/ProfileScreen";