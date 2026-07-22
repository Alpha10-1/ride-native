// Shared implementation lives in src/screens/WalletScreen.tsx (role-aware
// internally via the fetched profile). Both (rider) and (driver) route
// files import it directly — deliberately NOT re-exporting from each
// other's route file, since two route-group files sharing the same leaf
// name both resolve to the same URL path and can be misregistered.
export { default } from "../../src/screens/WalletScreen";