// Wallet logic is role-aware internally (top-up for riders, earnings for
// drivers), so we re-export the same screen rather than duplicating it.
export { default } from "../(rider)/wallet";