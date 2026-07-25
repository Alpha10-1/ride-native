// Supabase Edge Function: admin-create-account
//
// Creates a brand-new account directly — email + a password you set, no
// prior mobile app signup needed — and marks it as an admin immediately.
// This has to be a server-side function: creating an auth user with an
// arbitrary email/password requires Supabase's Admin API, which only
// works with the service_role key, and that key must NEVER be shipped to
// a browser app (it bypasses Row Level Security entirely).
//
// How it stays safe even though it's privileged:
//   1. It first verifies the CALLER (whoever hit this function from the
//      admin dashboard) is themselves a signed-in admin, using their own
//      JWT and the restricted anon-key client — same as every other admin
//      check in this project.
//   2. Only after that check passes does it switch to a service-role
//      client, used purely internally, never returned to the browser.
//
// DEPLOY:
//   supabase functions deploy admin-create-account
// (No extra secrets to set — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are automatically available to every Edge Function in your project.)

import { createClient } from "npm:@supabase/supabase-js@2.109.0";

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Step 1 — verify the caller is a signed-in admin, using their own
    // token against the restricted anon-key client (RLS still applies).
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
    }

    const { data: callerProfile, error: profileError } = await callerClient
      .from("profiles")
      .select("is_admin")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: "Only admins can create new admin accounts." }), { status: 403 });
    }

    // Step 2 — caller confirmed as admin. Now, and only now, use the
    // service-role client to actually create the account.
    const {
      email, password, username, firstName, lastName, cellphone, dateOfBirth,
    } = await req.json();

    if (!email || !password || !username || !firstName || !lastName) {
      return new Response(JSON.stringify({ error: "Missing required fields." }), { status: 400 });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters." }), { status: 400 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // staff-created account, skip the confirmation email
    });

    if (createError || !created.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create account." }), { status: 400 });
    }

    // 'staff' is exempt from the vehicle-fields requirement (only
    // 'driver' needs those — see 0022_staff_role.sql) and reads clearly
    // in any admin listing, unlike reusing 'rider' as a placeholder.
    const { error: insertError } = await adminClient.from("profiles").insert({
      id: created.user.id,
      username,
      first_name: firstName,
      last_name: lastName,
      email,
      cellphone: cellphone || "N/A",
      date_of_birth: dateOfBirth || "1990-01-01",
      role: "staff",
      agreed_to_terms: true,
      is_admin: true, // INSERT isn't guarded by the profiles UPDATE-only
                      // trigger (see 0016), so this is safe to set directly.
    });

    if (insertError) {
      // Roll back the auth user so we don't leave an orphaned account
      // with no profile if the insert failed (e.g. username taken).
      await adminClient.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({ error: insertError.message }), { status: 400 });
    }

    return new Response(JSON.stringify({ id: created.user.id, username, email }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});