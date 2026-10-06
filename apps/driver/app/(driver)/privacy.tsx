// Shared implementation lives in packages/shared/screens/PrivacyScreen.tsx
// (content is identical regardless of role). The rider and driver apps
// each have their own route file re-exporting it, like this one.
export { default } from "@ride/shared/screens/PrivacyScreen";