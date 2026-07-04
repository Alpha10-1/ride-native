// Trip history logic is role-aware internally (rides/receipts are filtered
// by rider_id OR driver_id server-side), so we re-export the same screen
// rather than duplicating it.
export { default } from "../(rider)/trip-history";