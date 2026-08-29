-- Admin-configurable driver dispatch radius.
--
-- Gap this closes: notify_new_ride_request() (most recently redefined in
-- 20260830090000_rider_ride_notifications.sql) hardcodes
-- v_radius_km constant double precision := 7 — the distance from pickup
-- within which online drivers get pushed a new ride request. There was
-- no way for an admin to change that without a code deploy. This
-- migration makes it a live-editable setting.
--
-- Singleton settings table, same shape/spirit as push_config (key
-- lookup) but typed since there's only one value today. `id boolean
-- primary key default true` + a `check (id)` is a standard singleton-row
-- trick: it makes a second row structurally impossible (boolean can
-- only be true/false, and false fails the check), so callers never have
-- to guess a row id.
create table if not exists public.dispatch_config (
  id boolean primary key default true,
  radius_km numeric not null default 7,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint dispatch_config_singleton check (id),
  constraint dispatch_config_radius_range check (radius_km > 0 and radius_km <= 100)
);

alter table public.dispatch_config enable row level security;
-- No policies added on purpose — same pattern as payout_requests etc.
-- Default-deny at the table level; all access goes through the
-- SECURITY DEFINER RPCs below, which do their own is_admin check.

insert into public.dispatch_config (id, radius_km)
values (true, 7)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Admin read/write RPCs (same is_admin-gated pattern as the other
-- admin_* RPCs — admin_list_payout_requests, admin_set_driver_test_mode,
-- etc.)
-- ---------------------------------------------------------------------
create or replace function public.admin_get_dispatch_config()
returns table (
  radius_km numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  return query
  select dc.radius_km, dc.updated_at
  from public.dispatch_config dc
  where dc.id = true;
end;
$$;

grant execute on function public.admin_get_dispatch_config() to authenticated;

create or replace function public.admin_update_dispatch_config(radius_km_in numeric)
returns table (
  radius_km numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  if radius_km_in is null or radius_km_in <= 0 or radius_km_in > 100 then
    raise exception 'Radius must be between 0 and 100 km.';
  end if;

  update public.dispatch_config dc
  set radius_km = radius_km_in,
      updated_at = now(),
      updated_by = auth.uid()
  where dc.id = true;

  return query
  select dc.radius_km, dc.updated_at
  from public.dispatch_config dc
  where dc.id = true;
end;
$$;

grant execute on function public.admin_update_dispatch_config(numeric) to authenticated;

-- ---------------------------------------------------------------------
-- Re-point notify_new_ride_request() to read the live radius instead of
-- the hardcoded constant. CREATE OR REPLACE on an unchanged signature is
-- safe to rerun and doesn't touch the existing trigger definition.
-- ---------------------------------------------------------------------
create or replace function public.notify_new_ride_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens text[];
  v_radius_km double precision;
begin
  if new.status <> 'requested' then
    return new;
  end if;

  select radius_km into v_radius_km from public.dispatch_config where id = true;
  -- Table missing a row, or not migrated in this environment yet — fall
  -- back to the original default rather than notifying zero drivers.
  if v_radius_km is null then
    v_radius_km := 7;
  end if;

  select array_agg(p.push_token) into v_tokens
  from public.driver_notification_presence dp
  join public.profiles p on p.id = dp.driver_id
  where dp.online = true
    and p.push_token is not null
    and coalesce(p.notify_push, true) = true
    -- Dual-role accounts (20260803120000_dual_role_driver_apply.sql)
    -- shouldn't get driver-side pushes while they're using the app as a
    -- rider, same principle as paystack-charge-recurring's notifyDriver.
    and coalesce(p.active_mode, 'driver') = 'driver'
    and dp.updated_at > now() - interval '15 minutes'
    and (
      6371 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(new.pickup_lat)) * cos(radians(dp.lat)) *
          cos(radians(dp.lng) - radians(new.pickup_lng)) +
          sin(radians(new.pickup_lat)) * sin(radians(dp.lat))
        ))
      )
    ) <= v_radius_km;

  perform public._send_push_notification(
    v_tokens,
    'New ride request',
    format('Pickup at %s', coalesce(new.pickup_label, new.pickup_address, 'a nearby location')),
    jsonb_build_object('type', 'new_ride_request', 'rideId', new.id)
  );

  return new;
end;
$$;
