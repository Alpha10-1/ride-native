-- Driver ratings — rider rates the driver (1-5 stars + optional comment)
-- once per completed ride. Aggregates onto profiles as avg_rating /
-- rating_count so the rest of the app (driver profile badge, admin
-- dashboard) can read a driver's standing without recomputing it every
-- time. Drivers with enough ratings and a low average are automatically
-- flagged for admin review — see flagged_for_review below.

create table if not exists public.ride_ratings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists ride_ratings_driver_id_idx
  on public.ride_ratings (driver_id, created_at desc);

alter table public.ride_ratings enable row level security;

-- Riders can see ratings they've personally left (their own history).
drop policy if exists "riders read own submitted ratings" on public.ride_ratings;
create policy "riders read own submitted ratings"
  on public.ride_ratings for select
  using (auth.uid() = rider_id);

-- Drivers can see the feedback left about them (stars + comment) —
-- useful for a driver-side "Ratings & Feedback" screen. Rider identity
-- isn't exposed by this policy beyond the rider_id column already on the
-- row; the app's driver-facing screen should not surface rider_id itself.
drop policy if exists "drivers read own received ratings" on public.ride_ratings;
create policy "drivers read own received ratings"
  on public.ride_ratings for select
  using (auth.uid() = driver_id);

-- No direct insert/update/delete policy — all writes go through
-- submit_ride_rating() below, which validates the ride belongs to the
-- caller, is completed, and hasn't already been rated.

-- ---------------------------------------------------------------------
-- Aggregate columns on profiles. Nullable/zero defaults so a driver with
-- no ratings yet reads as "not enough data" rather than a fabricated
-- perfect or zero score.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists avg_rating numeric(3,2),
  add column if not exists rating_count integer not null default 0,
  add column if not exists flagged_for_review boolean not null default false;

-- Minimum sample size before a low average triggers a flag — avoids
-- flagging a driver off one bad rating from their very first trip.
-- Recomputed on every new rating, so a driver's average recovering back
-- above the threshold automatically clears the flag too.
create or replace function public.recalculate_driver_rating(driver_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric(3,2);
  v_count integer;
  v_min_ratings_for_flag constant integer := 5;
  v_flag_threshold constant numeric := 4.0;
begin
  select round(avg(stars)::numeric, 2), count(*)
    into v_avg, v_count
    from public.ride_ratings
    where driver_id = driver_id_in;

  update public.profiles
    set avg_rating = v_avg,
        rating_count = coalesce(v_count, 0),
        flagged_for_review = (coalesce(v_count, 0) >= v_min_ratings_for_flag and v_avg < v_flag_threshold)
    where id = driver_id_in;
end;
$$;

-- ---------------------------------------------------------------------
-- Rider-facing entry point. Validates ownership + ride state server-side
-- rather than trusting the client, then writes the rating and refreshes
-- the driver's aggregate in the same transaction.
-- ---------------------------------------------------------------------
create or replace function public.submit_ride_rating(
  ride_id_in uuid,
  stars_in smallint,
  comment_in text default null
)
returns public.ride_ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride record;
  v_rating public.ride_ratings;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if stars_in < 1 or stars_in > 5 then
    raise exception 'Rating must be between 1 and 5 stars.';
  end if;

  select id, rider_id, driver_id, status into v_ride
    from public.rides
    where id = ride_id_in;

  if not found then
    raise exception 'Ride not found.';
  end if;

  if v_ride.rider_id <> auth.uid() then
    raise exception 'Not authorized to rate this ride.';
  end if;

  if v_ride.status <> 'completed' then
    raise exception 'This ride hasn''t been completed yet.';
  end if;

  if v_ride.driver_id is null then
    raise exception 'This ride has no driver to rate.';
  end if;

  if exists (select 1 from public.ride_ratings where ride_id = ride_id_in) then
    raise exception 'You''ve already rated this ride.';
  end if;

  insert into public.ride_ratings (ride_id, rider_id, driver_id, stars, comment)
    values (ride_id_in, auth.uid(), v_ride.driver_id, stars_in, nullif(trim(comment_in), ''))
    returning * into v_rating;

  perform public.recalculate_driver_rating(v_ride.driver_id);

  return v_rating;
end;
$$;

grant execute on function public.submit_ride_rating(uuid, smallint, text) to authenticated;

-- Lets the rider's post-trip screen check up front whether this ride has
-- already been rated, without needing select access to the whole row
-- (RLS above already allows that anyway, but this is the cheap check the
-- UI actually wants: "has this been rated yet, and with what").
create or replace function public.get_my_rating_for_ride(ride_id_in uuid)
returns public.ride_ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rating public.ride_ratings;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_rating
    from public.ride_ratings
    where ride_id = ride_id_in and rider_id = auth.uid();

  return v_rating;
end;
$$;

grant execute on function public.get_my_rating_for_ride(uuid) to authenticated;
