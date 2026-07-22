// Shared implementation lives in src/screens/NotificationsScreen.tsx (content is
// identical regardless of role). Both (rider) and (driver) route files
// import it directly — not from each other's route file.
export { default } from "../../src/screens/NotificationsScreen";