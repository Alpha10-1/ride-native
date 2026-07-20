// Supabase Edge Function: send-push
//
// This is the only piece that actually talks to Expo's push service —
// notify_push() in 0011_push_notifications.sql calls this over HTTP via
// pg_net. It exists as a separate function (rather than calling Expo
// directly from Postgres) because pg_net can only make plain HTTP calls,
// and because keeping a secret here (rather than in a trigger function
// anyone with SQL editor access could read) is safer.
//
// DEPLOY:
//   supabase functions deploy send-push
//
// SET THE SECRET (pick any long random string, must match push_config.function_secret):
//   supabase secrets set FUNCTION_SECRET=your-long-random-string
//
// THEN update these two rows in the database:
//   update public.push_config set value = 'https://<project-ref>.functions.supabase.co/send-push' where key = 'function_url';
//   update public.push_config set value = 'your-long-random-string' where key = 'function_secret';

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

    const messages = tokens
      .filter((t: unknown) => typeof t === "string" && t.startsWith("ExponentPushToken"))
      .map((to: string) => ({
        to,
        title,
        body,
        data: data ?? {},
        sound: "default",
      }));

    if (messages.length === 0) {
      return new Response(JSON.stringify({ skipped: "no valid expo tokens" }), { status: 200 });
    }

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    const result = await res.json();
    return new Response(JSON.stringify(result), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});