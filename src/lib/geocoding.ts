const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined;

export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  if (!GOOGLE_MAPS_API_KEY) return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
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
