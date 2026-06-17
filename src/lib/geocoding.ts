const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string | undefined;

export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  if (!TOKEN) return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  try {
    const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${longitude}&latitude=${latitude}&access_token=${TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocoding request failed (${res.status})`);

    const json = await res.json();
    const feature = json?.features?.[0];
    const name = feature?.properties?.full_address ?? feature?.properties?.name;

    return name ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  } catch {
    // Fall back to raw coordinates if geocoding fails for any reason
    // (network issue, rate limit, etc.) rather than blocking the user.
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }
}