-- Driver Test Mode — lets an admin flag a specific driver as "test
-- mode", which locks that driver down to ONLY the capabilities the
-- admin has explicitly turned on (an allowlist, not a blocklist) — e.g.
-- a new driver you want to walk through onboarding/UI with, without
-- letting them actually go online and pick up real paying riders yet.
--
-- Drivers with test_mode = false are completely unaffected — every check
-- below short-circuits to "allowed" for them, so this has zero effect on
-- normal driver accounts.

alter table public.profiles
  add column if not exists test_mode boolean not null default false,
  add column if not exists test_mode_permissions jsonb not null default '{}'::jsonb;

-- Canonical list of capability keys the admin dashboard renders as
-- checkboxes. Extending this list later is just adding a key here (no
-- schema change needed) — the jsonb column already accepts any keys,
-- this array is only used to validate admin input and to hand the
-- driver app a stable "what could I ask for" reference.
create or replace function public.test_mode_capability_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'go_online',              -- accept ride requests at all
    'accept_scheduled_rides', -- pre-booked/scheduled trips specifically
    'view_earnings',          -- wallet / earnings screen
    'download_statements',    -- statements PDF export
    'chat_support',           -- support chat
    'chat_riders',            -- in-trip chat with a rider
    'update_profile',         -- edit profile details/photo
    'upload_documents',       -- verification document upload
    'manage_subscription',    -- subscription/payment screen
    'receive_promotions'      -- promotions screen
  ];
$$;

-- ---------------------------------------------------------------------
-- Driver-side: what does MY account's test mode status look like right
-- now. Called once by the mobile app (see src/lib/testMode.ts) to decide
-- what to show/hide and to power the "TEST MODE" banner.
-- ---------------------------------------------------------------------
create or replace function public.get_my_test_mode_status()
returns table (test_mode boolean, permissions jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  return query
    select p.test_mode, p.test_mode_permissions
    from public.profiles p
    where p.id = auth.uid();
end;
$$;

grant execute on function public.get_my_test_mode_status() to authenticated;

-- Generic capability check other functions (or, in principle, future
-- ones) can call — true whenever test_mode is off (unrestricted), or
-- when it's on AND that specific key is explicitly granted.
create or replace function public.driver_has_test_capability(driver_id_in uuid, capability_key_in text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_test_mode boolean;
  v_perms jsonb;
begin
  select test_mode, test_mode_permissions into v_test_mode, v_perms
  from public.profiles where id = driver_id_in;

  if not found or not v_test_mode then
    return true;
  end if;

  return coalesce((v_perms ->> capability_key_in)::boolean, false);
end;
$$;

-- ---------------------------------------------------------------------
-- Hard server-side enforcement for the highest-stakes capability: going
-- online at all. Wraps the existing go_online_checked() RPC (itself a
-- wrapper around set_driver_online()) rather than modifying it —
-- src/lib/presence.ts's setDriverOnlineChecked() calls this instead.
-- Everything else (earnings, statements, chat, etc.) is enforced
-- client-side via get_my_test_mode_status() — lower-stakes than
-- accepting real trips from real riders, so a soft UI gate is
-- proportionate there.
-- ---------------------------------------------------------------------
create or replace function public.go_online_test_checked(
  lat_in double precision default null,
  lng_in double precision default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if not public.driver_has_test_capability(auth.uid(), 'go_online') then
    raise exception 'TEST_MODE_RESTRICTED: Going online has not been enabled for your test account yet.';
  end if;

  perform public.go_online_checked(lat_in, lng_in);
end;
$$;

grant execute on function public.go_online_test_checked(double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- Admin-side: set test mode + permissions for a chosen driver.
-- Same is_admin-gated pattern as the other admin_* RPCs (set_admin_status,
-- admin_set_suspended) from 0016/0020 — not modifying those, just
-- matching their existing convention.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_driver_test_mode(
  target_user_id uuid,
  test_mode_in boolean,
  permissions_in jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_allowed_keys text[] := public.test_mode_capability_keys();
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  if not exists (select 1 from public.profiles where id = target_user_id and role = 'driver') then
    raise exception 'Target user is not a driver.';
  end if;

  -- Validate every key in permissions_in is a recognized capability with
  -- a boolean value — reject anything else outright rather than storing
  -- garbage a typo'd admin request could otherwise silently write.
  for v_key in select jsonb_object_keys(permissions_in) loop
    if not (v_key = any(v_allowed_keys)) then
      raise exception 'Unknown test mode capability: %', v_key;
    end if;
    if jsonb_typeof(permissions_in -> v_key) <> 'boolean' then
      raise exception 'Capability % must be true or false.', v_key;
    end if;
  end loop;

  update public.profiles
    set test_mode = test_mode_in,
        test_mode_permissions = case when test_mode_in then permissions_in else '{}'::jsonb end
    where id = target_user_id;

  -- Turning test mode off (or narrowing go_online away) while the driver
  -- is currently online shouldn't leave them silently online and
  -- unmatchable-but-visible — force them offline the same way switching
  -- to rider mode does (20260803120000_dual_role_driver_apply.sql).
  if not test_mode_in or coalesce((permissions_in ->> 'go_online')::boolean, false) = false then
    begin
      update public.driver_notification_presence set online = false, updated_at = now()
        where driver_id = target_user_id;
    exception when others then
      null; -- best-effort, table may not have a row for this driver yet
    end;
  end if;
end;
$$;

grant execute on function public.admin_set_driver_test_mode(uuid, boolean, jsonb) to authenticated;

-- List drivers currently in test mode, for the admin dashboard's Test
-- Mode screen to show at a glance without a full driver search each time.
create or replace function public.admin_list_test_drivers()
returns table (
  id uuid,
  username text,
  first_name text,
  last_name text,
  test_mode_permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles a where a.id = auth.uid() and a.is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  return query
    select p.id, p.username, p.first_name, p.last_name, p.test_mode_permissions
    from public.profiles p
    where p.test_mode = true
    order by p.first_name, p.last_name;
end;
$$;

grant execute on function public.admin_list_test_drivers() to authenticated;
