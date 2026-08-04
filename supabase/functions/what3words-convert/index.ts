// Supabase Edge Function: what3words-convert
//
// Thin server-side proxy for the What3Words API, used so the
// W3W_API_KEY never ships in the app bundle. Handles both directions:
//
//   { mode: "to-coordinates", words: "filled.count.soap" }
//     -> { words, lat, lng, nearestPlace, country }
//
//   { mode: "to-words", lat: -26.123, lng: 27.987 }
//     -> { words, lat, lng, nearestPlace, country }
//
// Why this matters for this app: many townships and informal settlements
// have no reliable street addresses, so Google's reverse-geocode often
// falls back to raw coordinates (see src/lib/geocoding.ts). A
// what3words 3-word address gives riders and drivers a short, memorable,
// exact (~3m x 3m) way to communicate a pickup/drop-off location instead
// — this function is what resolves those addresses on both sides.
//
// DEPLOY:
//   supabase functions deploy what3words-convert
// SECRETS:
//   supabase secrets set W3W_API_KEY=xxxxxxx
//
// Deployed WITH default JWT verification (no --no-verify-jwt flag) so
// only signed-in app users (rider or driver) can call it — this just
// protects the API quota, there's no per-user data involved.

const W3W_API_KEY = (Deno.env.get("W3W_API_KEY") ?? "").trim();
const W3W_BASE_URL = "https://api.what3words.com/v3";

Deno.serve(async (req: Request) => {
  try {
    if (!W3W_API_KEY) {
      console.error("what3words-convert: W3W_API_KEY is empty/unset");
      return new Response(JSON.stringify({ error: "Server misconfigured: W3W_API_KEY is not set." }), { status: 500 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), { status: 400 });
    }

    const mode = body?.mode as string | undefined;
    let w3wUrl: string;

    if (mode === "to-coordinates") {
      const words = String(body?.words ?? "").trim().replace(/^\/+/, "");
      if (!words) {
        return new Response(JSON.stringify({ error: "words is required." }), { status: 400 });
      }
      w3wUrl = `${W3W_BASE_URL}/convert-to-coordinates?words=${encodeURIComponent(words)}&key=${W3W_API_KEY}`;
    } else if (mode === "to-words") {
      const lat = Number(body?.lat);
      const lng = Number(body?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return new Response(JSON.stringify({ error: "lat and lng must be numbers." }), { status: 400 });
      }
      w3wUrl = `${W3W_BASE_URL}/convert-to-3wa?coordinates=${lat},${lng}&key=${W3W_API_KEY}`;
    } else {
      return new Response(JSON.stringify({ error: 'mode must be "to-coordinates" or "to-words".' }), { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let w3wRes: Response;
    try {
      w3wRes = await fetch(w3wUrl, { signal: controller.signal });
    } catch (fetchErr) {
      console.error("what3words-convert: fetch to What3Words failed or timed out", String(fetchErr));
      return new Response(JSON.stringify({ error: `Couldn't reach What3Words: ${String(fetchErr)}` }), { status: 502 });
    } finally {
      clearTimeout(timeout);
    }

    const data = await w3wRes.json();

    if (!w3wRes.ok || data.error) {
      // What3Words returns { error: { code, message } } for bad input
      // (e.g. "BadWords" for a 3-word combination that doesn't exist) —
      // this is a normal, expected outcome (typo, made-up words), not a
      // server error, so pass it through as a 200 with a clear message
      // rather than surfacing a scary 4xx/5xx to the app.
      const message = data?.error?.message ?? `What3Words returned HTTP ${w3wRes.status}`;
      console.warn("what3words-convert: What3Words rejected the request", w3wRes.status, data?.error);
      return new Response(JSON.stringify({ error: message }), { status: 200 });
    }

    return new Response(
      JSON.stringify({
        words: data.words,
        lat: data.coordinates?.lat,
        lng: data.coordinates?.lng,
        nearestPlace: data.nearestPlace ?? null,
        country: data.country ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("what3words-convert: unhandled exception", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
