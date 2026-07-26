-- Registration & account recovery
--
-- This app logs in by username, so Supabase Auth (which requires an email)
-- is given a synthesized "<username>@ridenative.internal" address that the
-- user never sees. That's fine for login, but it means Supabase's built-in
-- password-reset-by-email and email-OTP can't reach anyone — there's no
-- real inbox behind that address.
--
-- The fix: right after registering, the client now calls
-- `supabase.auth.updateUser({ email: realEmail })` (see linkRecoveryEmail
-- in src/lib/auth.ts). Supabase emails a confirmation link to the *real*
-- address using its own built-in mailer — no extra infrastructure needed.
-- Once the user taps it, `auth.users.email` for that account changes from
-- the synthetic placeholder to their real, verified email, and Supabase's
-- native resetPasswordForEmail / signInWithOtp start working for them.
--
-- The one thing this breaks: username-based login can no longer assume the
-- synthetic email pattern, since a verified account's auth email is now
-- their real one. This RPC lets the client look up whichever email is
-- currently correct for a username before signing in.
create or replace function public.get_auth_email_for_username(username_in text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
  found_email text;
begin
  select id into found_id
  from public.profiles
  where username = lower(trim(username_in));

  if found_id is null then
    return null;
  end if;

  select email into found_email from auth.users where id = found_id;
  return found_email;
end;
$$;

grant execute on function public.get_auth_email_for_username(text) to anon, authenticated;
