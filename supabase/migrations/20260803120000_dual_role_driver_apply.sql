-- Dual-role support: a rider can apply to also become a driver without
-- losing their rider account, then switch between "rider" and "driver"
-- modes within the same login — instead of role being a single fixed
-- choice made once at signup.
--
-- profiles.role stays exactly as it was (still drives the original
-- signup path, the staff/admin check in app/_layout.tsx, etc.) — this
-- migration doesn't touch it. Two new columns sit alongside it:
--
--   is_driver    — true once someone has completed driver registration
--                  (via original driver signup, OR via the new Apply
--                  flow below). This is the "have they provided driver
--                  information" check the Apply banner needs.
--   active_mode  — which side of the app they're currently using:
--                  'rider' or 'driver'. This is what should now decide
--                  routing/notifications/etc. going forward, not role,
--                  since a dual-registered account can be either.

alter table public.profiles
  add column if not exists is_driver boolean not null default false,
  add column if not exists active_mode text not null default 'rider'
    check (active_mode in ('rider', 'driver'));

-- Backfill: anyone who originally signed up as a driver already provided
-- driver info at signup and should land back in driver mode, same as
-- today's behavior (redirectAfterAuth routing on role='driver').
update public.profiles
  set is_driver = true, active_mode = 'driver'
  where role = 'driver';

-- Switches which side of the app the signed-in user is currently using.
-- Going 'driver' -> 'rider' takes them offline server-side first (not
-- best-effort — a driver "using the rider app" absolutely should not
-- still be visible/matchable for new ride requests), via the existing
-- set_driver_online RPC so this stays consistent with the normal Go
-- Offline toggle instead of writing to whatever presence table directly.
create or replace function public.switch_active_mode(mode_in text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if mode_in not in ('rider', 'driver') then
    raise exception 'Invalid mode: %', mode_in;
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Profile not found.';
  end if;

  if mode_in = 'driver' and not v_profile.is_driver then
    -- Distinct, matchable error code (not just a message) so the client
    -- can tell "needs to register first" apart from a generic failure
    -- and route straight into the registration flow instead of just
    -- showing an error banner.
    raise exception 'DRIVER_NOT_REGISTERED' using errcode = 'P0001';
  end if;

  if v_profile.active_mode = 'driver' and mode_in = 'rider' then
    begin
      perform public.set_driver_online(online_in := false, lat_in := null, lng_in := null);
    exception when others then
      -- set_driver_online is a pre-existing RPC this migration doesn't
      -- own — if its signature or behavior ever changes upstream, a
      -- failure here shouldn't be able to block someone from switching
      -- to rider mode. The client also calls the local
      -- setDriverOnline(false) right after a successful switch as a
      -- second, independent path to the same end state.
      raise notice 'switch_active_mode: set_driver_online(false) failed: %', sqlerrm;
    end;
  end if;

  update public.profiles
    set active_mode = mode_in
    where id = auth.uid()
    returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.switch_active_mode(text) to authenticated;

-- Submits (or re-submits, e.g. after a rejection) the basic driver
-- registration details — license number + vehicle info, mirroring what
-- driver signup collects in registerUser(). Document upload is a
-- separate step (existing submit_driver_document flow in
-- verification.ts) that the client sends the rider to immediately after
-- this succeeds. Marks is_driver = true and switches active_mode to
-- 'driver' right away so "Apply" really does immediately start the
-- driver side of the app, per product requirement, rather than leaving
-- them stranded on the rider screens after submitting.
create or replace function public.submit_driver_registration(
  license_number_in text,
  vehicle_make_in text,
  vehicle_model_in text,
  license_plate_in text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Profile not found.';
  end if;
  if v_profile.role = 'staff' then
    raise exception 'Staff accounts cannot register as a driver.';
  end if;
  if trim(coalesce(license_number_in, '')) = '' then
    raise exception 'Driver license number is required.';
  end if;
  if trim(coalesce(vehicle_make_in, '')) = '' or trim(coalesce(vehicle_model_in, '')) = '' then
    raise exception 'Vehicle make and model are required.';
  end if;
  if trim(coalesce(license_plate_in, '')) = '' then
    raise exception 'License plate is required.';
  end if;

  update public.profiles
    set is_driver = true,
        active_mode = 'driver',
        driver_license_number = trim(license_number_in),
        vehicle_make = trim(vehicle_make_in),
        vehicle_model = trim(vehicle_model_in),
        license_plate = trim(license_plate_in),
        -- Re-applying after a rejection should go back to 'pending', not
        -- stay stuck on 'rejected' with no way forward. Leave 'verified'
        -- alone though — updating vehicle details shouldn't strip an
        -- already-verified driver back down to needing re-review.
        verification_status = case
          when v_profile.verification_status in ('unverified', 'rejected') then 'pending'
          else v_profile.verification_status
        end
    where id = auth.uid()
    returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.submit_driver_registration(text, text, text, text) to authenticated;
