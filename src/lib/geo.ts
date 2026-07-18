// Haversine distance between two lat/lng points, in kilometers.
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// Simulates real dispatch behavior: a new ride request is only broadcast to
// very close drivers at first, then the search radius widens over time if
// nobody has picked it up yet.
//   0–10s:        600 m
//   10s onward:   +300 m every 7s
//   cap:          1.6 km
export function progressiveRadiusKm(requestedAt: string, nowMs: number = Date.now()): number {
  const elapsedSec = (nowMs - new Date(requestedAt).getTime()) / 1000;
  if (elapsedSec < 10) return 0.6;
  const steps = Math.floor((elapsedSec - 10) / 7) + 1;
  const meters = Math.min(600 + steps * 300, 1600);
  return meters / 1000;
}