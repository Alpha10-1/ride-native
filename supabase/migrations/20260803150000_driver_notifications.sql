-- Driver notifications: new ride requests, ride updates, payment
-- settlement, and announcements.
--
-- send-push (supabase/functions/send-push/index.ts) is already deployed
-- and already documents the calling convention: a public.push_config
-- table holds 'function_url' and 'function_secret', called via pg_net
-- from SQL. This migration follows that exact same convention rather
-- than re-guessing it, and is purely additive — it doesn't touch
-- whatever pre-existing presence/push infrastructure (0011/0012
-- migrations, not in this repo) already does.
--
-- IMPORTANT — before any of this can actually deliver a push:
--   1. pg_net must be enabled:  create extension if not exists pg_net;
--   2. public.push_config must already have 'function_url' and
--      'function_secret' rows set (per send-push's own deploy notes) —
--      if those aren't set yet, every trigger here just silently no-ops
--      (see _send_push_notification below) rather than erroring, so a
--      ride can never fail to complete just because a push failed to
--      send.

-- ---------------------------------------------------------------------
-- Driver notification presence (deliberately a NEW, separate table —
-- not touching whatever the existing driver-presence table from 0012 is
-- called, since its exact schema isn't visible from this repo and
-- guessing wrong risks broken SQL against a live table.)
-- ---------------------------------------------------------------------
create table if not exists public.driver_notification_presence (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision,
  lng double precision,
  online boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.driver_notification_presence enable row level security;

drop policy if exists "drivers manage own notification presence" on public.driver_notification_presence;
create policy "drivers manage own notification presence"
  on public.driver_notification_presence for all
  using (auth.uid() = driver_id);

-- Called alongside the existing update_my_location/set_driver_online
-- RPCs (see src/lib/presence.ts) — additive, doesn't replace them.
create or replace function public.ping_driver_notification_location(
  lat_in double precision,
  lng_in double precision,
  online_in boolean default true
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
  insert into public.driver_notification_presence (driver_id, lat, lng, online, updated_at)
  values (auth.uid(), lat_in, lng_in, online_in, now())
  on conflict (driver_id) do update
    set lat = excluded.lat, lng = excluded.lng, online = excluded.online, updated_at = now();
end;
$$;

grant execute on function public.ping_driver_notification_location(double precision, double precision, boolean) to authenticated;

create or replace function public.set_driver_notification_offline()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  update public.driver_notification_presence set online = false, updated_at = now()
    where driver_id = auth.uid();
end;
$$;

grant execute on function public.set_driver_notification_offline() to authenticated;

-- ---------------------------------------------------------------------
-- Shared push-sending helper. Not granted to authenticated/anon — only
-- callable from other SECURITY DEFINER functions owned by the same
-- role, i.e. the trigger functions below.
-- ---------------------------------------------------------------------
create or replace function public._send_push_notification(
  tokens_in text[],
  title_in text,
  body_in text,
  data_in jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  if tokens_in is null or array_length(tokens_in, 1) is null then
    return;
  end if;

  select value into v_url from public.push_config where key = 'function_url';
  select value into v_secret from public.push_config where key = 'function_secret';

  -- Not configured yet — no-op rather than error. A push failing to
  -- send must never be able to block the ride/payment/announcement
  -- operation that triggered it.
  if v_url is null or v_secret is null then
    return;
  end if;

  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'tokens', to_jsonb(tokens_in),
        'title', title_in,
        'body', body_in,
        'data', data_in
      )
    );
  exception when others then
    -- pg_net not enabled, network hiccup, whatever — same reasoning as
    -- above, this must never be able to fail the triggering operation.
    raise notice '_send_push_notification failed: %', sqlerrm;
  end;
end;
$$;

revoke all on function public._send_push_notification(text[], text, text, jsonb) from public;

-- ---------------------------------------------------------------------
-- New ride requests -> nearby online drivers
-- ---------------------------------------------------------------------
-- Plain haversine distance, no PostGIS dependency (can't assume it's
-- enabled). Radius and candidate cap are conservative defaults —
-- tune freely later, this is just wiring the notification through.
create or replace function public.notify_new_ride_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens text[];
  v_radius_km constant double precision := 7;
begin
  if new.status <> 'requested' then
    return new;
  end if;

  select array_agg(p.push_token) into v_tokens
  from public.driver_notification_presence dp
  join public.profiles p on p.id = dp.driver_id
  where dp.online = true
    and p.push_token is not null
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

drop trigger if exists rides_notify_new_ride_request on public.rides;
create trigger rides_notify_new_ride_request
  after insert on public.rides
  for each row execute function public.notify_new_ride_request();

-- ---------------------------------------------------------------------
-- Ride + payment updates -> the assigned driver
-- ---------------------------------------------------------------------
create or replace function public.notify_ride_driver_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_active_mode text;
begin
  if new.driver_id is null then
    return new;
  end if;

  select push_token, active_mode into v_token, v_active_mode
  from public.profiles where id = new.driver_id;

  if v_token is null or coalesce(v_active_mode, 'driver') <> 'driver' then
    return new;
  end if;

  -- Rider cancelled a trip this driver was already on.
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.cancelled_by = 'rider' then
    perform public._send_push_notification(
      array[v_token],
      'Trip cancelled',
      'The rider has cancelled this trip.',
      jsonb_build_object('type', 'ride_status', 'rideId', new.id)
    );
  end if;

  -- Payment settled (or failed) for a completed trip — payment_method
  -- and payment_status are from 20260802120000_rider_payments.sql, this
  -- migration's own earlier work, so these columns are known-good.
  if new.payment_status is distinct from old.payment_status and new.payment_method <> 'cash' then
    if new.payment_status = 'paid' then
      perform public._send_push_notification(
        array[v_token],
        'Payment received',
        format('You''ve been paid for your last trip (%s).',
          case when new.payment_method = 'wallet' then 'wallet' else 'card' end),
        jsonb_build_object('type', 'ride_status', 'rideId', new.id)
      );
    elsif new.payment_status = 'failed' then
      perform public._send_push_notification(
        array[v_token],
        'Payment issue',
        'The rider''s payment for your last trip didn''t go through yet.',
        jsonb_build_object('type', 'ride_status', 'rideId', new.id)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rides_notify_driver_events on public.rides;
create trigger rides_notify_driver_events
  after update on public.rides
  for each row execute function public.notify_ride_driver_events();

-- ---------------------------------------------------------------------
-- Announcements (broadcast to riders, drivers, or everyone)
-- ---------------------------------------------------------------------
-- No admin UI exists in this codebase to create these from yet — this is
-- the DB-level plumbing so one can be inserted (SQL editor, or a future
-- admin tool) and it broadcasts immediately.
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all' check (audience in ('riders', 'drivers', 'all')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

alter table public.announcements enable row level security;

drop policy if exists "signed in users read announcements" on public.announcements;
create policy "signed in users read announcements"
  on public.announcements for select
  using (auth.uid() is not null);

create or replace function public.notify_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens text[];
begin
  select array_agg(push_token) into v_tokens
  from public.profiles
  where push_token is not null
    and (
      new.audience = 'all'
      or (new.audience = 'drivers' and coalesce(active_mode, role) = 'driver')
      or (new.audience = 'riders' and coalesce(active_mode, role) = 'rider')
    );

  perform public._send_push_notification(
    v_tokens,
    new.title,
    new.body,
    jsonb_build_object('type', 'announcement', 'announcementId', new.id)
  );

  return new;
end;
$$;

drop trigger if exists announcements_notify on public.announcements;
create trigger announcements_notify
  after insert on public.announcements
  for each row execute function public.notify_announcement();
