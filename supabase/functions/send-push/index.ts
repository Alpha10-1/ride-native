// Supabase Edge Function: send-push
//
// This is the only piece that actually talks to Expo's push service —
// notify_push() in 0011_push_notifications.sql calls this over HTTP via
// pg_net. It exists as a separate function (rather than calling Expo
// directly from Postgres) because pg_net can only make plain HTTP calls,
// and because keeping a secret here (rather than in a trigger function
// anyone with SQL editor access could read) is safer.
//
// Since the rider/driver split, one call's tokens can belong to two
// different Expo projects (@alpha_lubisi/ride-native and
// @alpha_lubisi/ride-driver), and Expo rejects a whole request that mixes
// projects (PUSH_TOO_MANY_EXPERIENCE_IDS) or has more than 100 messages
// (PUSH_TOO_MANY_NOTIFICATIONS). So tokens are de-duplicated, sent in
// chunks of at most 100, and a chunk rejected for mixing projects is
// split per project (using the token mapping Expo returns in the error's
// `details`) and resent once.
//
// DEPLOY:
//   supabase functions deploy send-push --no-verify-jwt
// (--no-verify-jwt is required — pg_net calls this with the
// FUNCTION_SECRET below, not a Supabase JWT, so the platform's JWT check
// would reject every call before it got here. supabase/config.toml also
// sets verify_jwt = false for send-push.)
//
// SET THE SECRET (pick any long random string, must match push_config.function_secret):
//   supabase secrets set FUNCTION_SECRET=your-long-random-string
//
// THEN update these two rows in the database:
//   update public.push_config set value = 'https://<project-ref>.functions.supabase.co/send-push' where key = 'function_url';
//   update public.push_config set value = 'your-long-random-string' where key = 'function_secret';

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_MESSAGES_PER_REQUEST = 100; // Expo's hard limit per request

type PushMessage = { to: string; title: unknown; body: unknown; data: unknown; sound: string };
type BatchResult = { ok: boolean; tickets: unknown[]; errors: any[] };

// One POST to Expo. Never throws — a network failure or an unexpected
// response comes back as a failed result, so one bad chunk can't stop
// the others from sending.
async function postToExpo(messages: PushMessage[]): Promise<BatchResult> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    const text = await res.text();
    let result: any = null;
    try {
      result = JSON.parse(text);
    } catch {
      // Not JSON (e.g. a gateway error page) — reported below.
    }

    // Request-level errors come back as { errors: [...] }, normally with
    // a 4xx/5xx status (Expo's own SDK treats them as fatal even on a 200).
    const errors = Array.isArray(result?.errors)
      ? result.errors.map((e: any) => ({ status: res.status, ...e }))
      : [];
    const tickets = Array.isArray(result?.data) ? result.data : [];

    if (res.ok && errors.length === 0 && Array.isArray(result?.data)) {
      return { ok: true, tickets, errors: [] };
    }
    if (errors.length === 0) {
      errors.push({ status: res.status, code: "UNEXPECTED_RESPONSE", message: text.slice(0, 500) });
    }
    return { ok: false, tickets, errors };
  } catch (err) {
    return { ok: false, tickets: [], errors: [{ code: "FETCH_FAILED", message: String(err) }] };
  }
}

// Splits messages using PUSH_TOO_MANY_EXPERIENCE_IDS details, which maps
// each Expo project name to the tokens from the request that belong to it.
// Any token Expo didn't list gets its own extra group, so nothing is dropped.
function splitByExperience(messages: PushMessage[], details: Record<string, unknown>): PushMessage[][] {
  const groupOfToken = new Map<string, number>();
  const tokenLists = Object.values(details);
  tokenLists.forEach((tokens, i) => {
    if (!Array.isArray(tokens)) return;
    for (const token of tokens) {
      if (typeof token === "string" && !groupOfToken.has(token)) groupOfToken.set(token, i);
    }
  });

  const groups: PushMessage[][] = tokenLists.map(() => []);
  const unlisted: PushMessage[] = [];
  for (const message of messages) {
    const i = groupOfToken.get(message.to);
    (i === undefined ? unlisted : groups[i]).push(message);
  }
  return [...groups, unlisted].filter((group) => group.length > 0);
}

// Sends one chunk; if Expo rejects it for mixing projects, resends it as
// one request per project. The resends are never split again, so a
// misbehaving response can't cause a loop — they just report their errors.
async function sendChunk(messages: PushMessage[]): Promise<BatchResult[]> {
  const first = await postToExpo(messages);
  const mixed = first.errors.find((e) => e?.code === "PUSH_TOO_MANY_EXPERIENCE_IDS");
  if (!mixed || !mixed.details || typeof mixed.details !== "object") {
    return [first];
  }

  const groups = splitByExperience(messages, mixed.details);
  if (groups.length < 2) {
    return [first]; // splitting wouldn't change the request, so resending can't help
  }

  const results: BatchResult[] = [];
  for (const group of groups) {
    results.push(await postToExpo(group));
  }
  return results;
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("FUNCTION_SECRET");
  const authHeader = req.headers.get("Authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { tokens, title, body, data } = await req.json();

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no tokens" }), { status: 200 });
    }

    const validTokens: string[] = tokens.filter(
      (t: unknown) => typeof t === "string" && t.startsWith("ExponentPushToken"),
    );
    const messages: PushMessage[] = [...new Set(validTokens)].map((to: string) => ({
      to,
      title,
      body,
      data: data ?? {},
      sound: "default",
    }));

    if (messages.length === 0) {
      return new Response(JSON.stringify({ skipped: "no valid expo tokens" }), { status: 200 });
    }

    // Sequential rather than all at once, to stay well inside Expo's
    // per-project rate limit on large sends (e.g. announcements to "all").
    const results: BatchResult[] = [];
    for (let i = 0; i < messages.length; i += MAX_MESSAGES_PER_REQUEST) {
      results.push(...(await sendChunk(messages.slice(i, i + MAX_MESSAGES_PER_REQUEST))));
    }

    // Per-message tickets (including per-device errors like
    // DeviceNotRegistered) are Expo's normal 200 response, same as before.
    // Only a request Expo rejected outright, or that never got an answer,
    // makes the whole call non-2xx (502: the failure was upstream at Expo).
    const tickets = results.flatMap((r) => r.tickets);
    const errors = results.flatMap((r) => r.errors);
    const allOk = results.every((r) => r.ok);
    return new Response(JSON.stringify(allOk ? { data: tickets } : { data: tickets, errors }), {
      status: allOk ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
