// Shared implementation lives in packages/shared/screens/TripHistoryScreen.tsx
// (lists rides from either side, checking per ride whether the signed-in
// user was the driver or the rider). The rider and driver apps each have
// their own route file re-exporting it, like this one.
export { default } from "@ride/shared/screens/TripHistoryScreen";