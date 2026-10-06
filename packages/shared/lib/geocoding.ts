const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined;

// Shared by every Google Maps REST call in the app (geocoding, directions,
// places search) — plain fetch() has no timeout of its own, so a stalled
// request just hangs instead of rejecting, leaving whatever UI is waiting
// on it (search spinner, "Confirming...", route refinement) stuck forever.
export async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 8_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  if (!GOOGLE_MAPS_API_KEY) return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Geocoding request failed (${res.status})`);

    const json = await res.json();
    const result = json?.results?.[0];
    const name = result?.formatted_address;

    return name ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  } catch {
    // Fall back to raw coordinates if geocoding fails for any reason
    // (network issue, rate limit, etc.) rather than blocking the user.
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }
}
