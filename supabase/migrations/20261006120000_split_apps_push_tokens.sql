-- Separate rider and driver apps: one push token per app.
--
-- Context: ride-native is now two apps (apps/rider, apps/driver) sharing this
-- one Supabase project. Until now each account had a single
-- profiles.push_token, written by whichever app last registered. With both
-- apps installed, opening the rider app would steal "New ride request" pushes
-- away from the driver app (and the other way round for "Driver on the way").
--
-- What this migration does:
--   1. Adds profiles.rider_push_token / profiles.driver_push_token, written via
--      register_push_token(app, token) by each app.
--   2. Keeps the legacy profiles.push_token pointed at the token of the app
--      the person is currently using (by active_mode). The push triggers for
--      chat messages, fare offers, support replies and SOS were created in
--      base migrations that aren't in this repo (0011 and friends) and read
--      push_token directly, so this keeps them delivering to the right app
--      without having to rewrite functions we can't see.
--   3. Re-points the notification functions that ARE in this repo to pick the
--      right app's token explicitly: new ride requests and driver events go
--      to the driver app, rider events to the rider app, announcements to
--      whichever app(s) match the audience.
--
-- Backwards compatible with the pre-split app: accounts that have never
-- registered a per-app token keep the old behavior exactly (legacy
-- push_token + the old active_mode guard). Safe to re-run.

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists rider_push_token text,
  add column if not exists driver_push_token text;

-- register_push_token() looks tokens up across accounts (see below).
create index if not exists profiles_rider_push_token_idx
  on public.profiles (rider_push_token) where rider_push_token is not null;
create index if not exists profiles_driver_push_token_idx
  on public.profiles (driver_push_token) where driver_push_token is not null;
create index if not exists profiles_push_token_idx
  on public.profiles (push_token) where push_token is not null;

-- ---------------------------------------------------------------------
-- 2. Which token reaches a given app for an account
-- ---------------------------------------------------------------------
-- Split-era accounts (registered at least one per-app token): exactly that
-- app's token, or null if that app isn't installed / has no permission.
-- Legacy accounts (no per-app tokens yet, i.e. still on the pre-split
-- app): the single push_token, with the same active_mode guard the old
-- triggers used, so their behavior is unchanged.
create or replace function public._app_push_token(
  legacy_token text,
  rider_token text,
  driver_token text,
  active_mode_in text,
  app_in text
)
returns text
language sql
immutable
as $$
  select case
    when rider_token is not null or driver_token is not null then
      case when app_in = 'driver' then driver_token else rider_token end
    when app_in = 'driver' and coalesce(active_mode_in, 'driver') = 'driver' then legacy_token
    when app_in = 'rider' and coalesce(active_mode_in, 'rider') = 'rider' then legacy_token
    else null
  end
$$;

-- ---------------------------------------------------------------------
-- 3. Keep the legacy push_token in sync for split-era accounts
-- ---------------------------------------------------------------------
-- Fires when either app registers a token, and when active_mode changes
-- (each app claims its own mode when opened — see
-- packages/shared/lib/appMode.ts). Also fires on direct writes to
-- push_token, so a stale pre-split build can't re-point a split-era
-- account's notifications. Legacy accounts are left exactly as written.
create or replace function public._sync_legacy_push_token()
returns trigger
language plpgsql
as $$
begin
  if new.rider_push_token is null and new.driver_push_token is null then
    -- Signed out of (or unregistered) the last app that had a token: clear
    -- the legacy column too, or _app_push_token() would treat this as a
    -- pre-split account and keep pushing to the stale token.
    if tg_op = 'UPDATE' and (old.rider_push_token is not null or old.driver_push_token is not null) then
      new.push_token := null;
    end if;
    -- Otherwise a genuine pre-split account: leave push_token as written.
    return new;
  end if;

  new.push_token := case
    when new.active_mode = 'driver' then new.driver_push_token
    else new.rider_push_token
  end;
  return new;
end;
$$;

drop trigger if exists profiles_sync_legacy_push_token on public.profiles;
create trigger profiles_sync_legacy_push_token
  before insert or update of active_mode, rider_push_token, driver_push_token, push_token
  on public.profiles
  for each row execute function public._sync_legacy_push_token();

-- ---------------------------------------------------------------------
-- 4. Client RPCs
-- ---------------------------------------------------------------------
-- Called by each app on sign-in / launch (savePushToken in
-- packages/shared/lib/pushNotifications.ts).
--
-- An Expo push token identifies one app install on one device, so if a
-- different account was signed in on this device before, it must stop
-- receiving its notifications here — otherwise the next person to sign in
-- on a shared phone sees the previous account's trip updates. The rider
-- app keeps the pre-split app's token, so the legacy column is cleared too.
create or replace function public.register_push_token(app_in text, token_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if app_in not in ('rider', 'driver') then
    raise exception 'Invalid app: %', app_in;
  end if;
  if token_in is null or length(trim(token_in)) = 0 then
    raise exception 'Push token is required.';
  end if;

  if app_in = 'driver' then
    update public.profiles set driver_push_token = null
      where driver_push_token = token_in and id <> auth.uid();
    update public.profiles set driver_push_token = token_in
      where id = auth.uid();
  else
    update public.profiles set rider_push_token = null
      where rider_push_token = token_in and id <> auth.uid();
    update public.profiles set rider_push_token = token_in
      where id = auth.uid();
  end if;

  update public.profiles set push_token = null
    where push_token = token_in and id <> auth.uid();
end;
$$;

grant execute on function public.register_push_token(text, text) to authenticated;

-- Called on sign-out, only clearing the token if it's still this device's
-- (so signing out on one phone doesn't silence another).
create or replace function public.unregister_push_token(app_in text, token_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if app_in = 'driver' then
    update public.profiles set driver_push_token = null
      where id = auth.uid() and driver_push_token = token_in;
  elsif app_in = 'rider' then
    update public.profiles set rider_push_token = null
      where id = auth.uid() and rider_push_token = token_in;
  end if;
end;
$$;

grant execute on function public.unregister_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Re-point the notification functions in this repo
-- ---------------------------------------------------------------------
-- Each is the latest definition (20260830100000_admin_dispatch_config.sql
-- for notify_new_ride_request, 20260830090000_rider_ride_notifications.sql
-- for the rest) with only the token selection changed, plus the one fix
-- noted inline. Signatures are unchanged, so the existing triggers keep
-- pointing at them.

-- New ride request -> online drivers nearby, in the driver app.
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
  if v_radius_km is null then
    v_radius_km := 7;
  end if;

  select array_agg(distinct t.token) into v_tokens
  from (
    select public._app_push_token(
             p.push_token, p.rider_push_token, p.driver_push_token, p.active_mode, 'driver'
           ) as token
    from public.driver_notification_presence dp
    join public.profiles p on p.id = dp.driver_id
    where dp.online = true
      and coalesce(p.notify_push, true) = true
      -- Someone using the rider app isn't driving (opening the rider app
      -- takes a driver offline — see appMode.ts), same principle as before.
      and coalesce(p.active_mode, 'driver') = 'driver'
      -- Never offer a rider their own request (dual-role accounts).
      and dp.driver_id is distinct from new.rider_id
      and dp.updated_at > now() - interval '15 minutes'
      and (
        6371 * acos(
          least(1.0, greatest(-1.0,
            cos(radians(new.pickup_lat)) * cos(radians(dp.lat)) *
            cos(radians(dp.lng) - radians(new.pickup_lng)) +
            sin(radians(new.pickup_lat)) * sin(radians(dp.lat))
          ))
        )
      ) <= v_radius_km
  ) t
  where t.token is not null;

  perform public._send_push_notification(
    v_tokens,
    'New ride request',
    format('Pickup at %s', coalesce(new.pickup_label, new.pickup_address, 'a nearby location')),
    jsonb_build_object('type', 'new_ride_request', 'rideId', new.id)
  );

  return new;
end;
$$;

-- Events for the driver on a ride -> driver app.
create or replace function public.notify_ride_driver_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_notify_push boolean;
begin
  if new.driver_id is null then
    return new;
  end if;

  select public._app_push_token(push_token, rider_push_token, driver_push_token, active_mode, 'driver'),
         notify_push
    into v_token, v_notify_push
  from public.profiles where id = new.driver_id;

  if v_token is null or coalesce(v_notify_push, true) <> true then
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

  -- Payment settled (or failed) for a completed trip.
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

-- Events for the rider on a ride -> rider app.
create or replace function public.notify_ride_rider_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_notify_push boolean;
begin
  if new.rider_id is null then
    return new;
  end if;

  select public._app_push_token(push_token, rider_push_token, driver_push_token, active_mode, 'rider'),
         notify_push
    into v_token, v_notify_push
  from public.profiles where id = new.rider_id;

  if v_token is null or coalesce(v_notify_push, true) <> true then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public._send_push_notification(
        array[v_token],
        'Driver on the way',
        'A driver has accepted your ride and is heading your way.',
        jsonb_build_object('type', 'ride_status', 'rideId', new.id)
      );
    elsif new.status = 'driver_arrived' then
      perform public._send_push_notification(
        array[v_token],
        'Your driver has arrived',
        'Your driver is waiting for you at the pickup point.',
        jsonb_build_object('type', 'ride_status', 'rideId', new.id)
      );
    elsif new.status = 'completed' then
      perform public._send_push_notification(
        array[v_token],
        'Trip completed',
        case
          when new.final_fare_cents is not null then
            format('Your trip has ended. Total fare: R%s.',
              to_char(new.final_fare_cents / 100.0, 'FM999999990.00'))
          else
            'Your trip has ended. Thanks for riding with RIDE!'
        end,
        jsonb_build_object('type', 'ride_status', 'rideId', new.id)
      );
    elsif new.status = 'cancelled' and new.cancelled_by = 'driver' then
      perform public._send_push_notification(
        array[v_token],
        'Trip cancelled',
        'Your driver has cancelled this trip. We''re sorry for the inconvenience.',
        jsonb_build_object('type', 'ride_status', 'rideId', new.id)
      );
    end if;
  end if;

  return new;
end;
$$;

-- Announcements -> the driver app for 'drivers', the rider app for
-- 'riders', both for 'all'. Legacy accounts resolve to their single token
-- under the same rules as before.
create or replace function public.notify_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens text[];
begin
  select array_agg(distinct t.token) into v_tokens
  from (
    select public._app_push_token(push_token, rider_push_token, driver_push_token, active_mode, 'driver') as token
    from public.profiles
    where new.audience in ('all', 'drivers')
      and coalesce(is_driver, false) = true
      and coalesce(notify_push, true) = true
    union all
    select public._app_push_token(push_token, rider_push_token, driver_push_token, active_mode, 'rider') as token
    from public.profiles
    where new.audience in ('all', 'riders')
      and coalesce(notify_push, true) = true
  ) t
  where t.token is not null;

  perform public._send_push_notification(
    v_tokens,
    new.title,
    new.body,
    jsonb_build_object('type', 'announcement', 'announcementId', new.id)
  );

  return new;
end;
$$;
