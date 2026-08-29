-- Rider-side ride status push notifications, and making the notify_push
-- preference (src/screens/NotificationsScreen.tsx) actually mean
-- something server-side.
--
-- Gap this closes: 20260803150000_driver_notifications.sql wired up
-- announcements and driver-side notifications (new ride request nearby,
-- rider cancelled, payment settled/failed) but nothing on the rider side
-- for driver_arrived / completed / accepted / driver-cancelled — riders
-- had no push notifications for the events they most need to be alerted
-- to. It also never checked profiles.notify_push, so toggling push off
-- in-app had no effect on whether the server actually sent one.
--
-- Purely additive/idempotent: only CREATE OR REPLACEs existing functions
-- and adds one new trigger. Doesn't touch table schema.

-- ---------------------------------------------------------------------
-- Ride status updates -> the rider on that ride
-- ---------------------------------------------------------------------
create or replace function public.notify_ride_rider_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_active_mode text;
  v_notify_push boolean;
begin
  if new.rider_id is null then
    return new;
  end if;

  select push_token, active_mode, notify_push
    into v_token, v_active_mode, v_notify_push
  from public.profiles where id = new.rider_id;

  -- Same dual-role guard as notify_ride_driver_events: don't push a rider
  -- event to someone currently using the app as a driver, and respect the
  -- in-app push toggle (defaults to true for rows predating the column).
  if v_token is null
     or coalesce(v_active_mode, 'rider') <> 'rider'
     or coalesce(v_notify_push, true) <> true then
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

drop trigger if exists rides_notify_rider_events on public.rides;
create trigger rides_notify_rider_events
  after update on public.rides
  for each row execute function public.notify_ride_rider_events();

-- ---------------------------------------------------------------------
-- Re-point existing notification functions to respect notify_push too.
-- CREATE OR REPLACE on a function with an unchanged signature is safe to
-- rerun and doesn't touch the trigger definitions already pointing at it.
-- ---------------------------------------------------------------------
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

create or replace function public.notify_ride_driver_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_active_mode text;
  v_notify_push boolean;
begin
  if new.driver_id is null then
    return new;
  end if;

  select push_token, active_mode, notify_push
    into v_token, v_active_mode, v_notify_push
  from public.profiles where id = new.driver_id;

  if v_token is null
     or coalesce(v_active_mode, 'driver') <> 'driver'
     or coalesce(v_notify_push, true) <> true then
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
    and coalesce(notify_push, true) = true
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
