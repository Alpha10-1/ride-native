-- Rider-initiated negotiation rules
--
-- 1. Riders (not drivers) start every negotiation. A rider broadcasts one
--    proposed fare on the ride itself; any driver polling the pending list
--    can then accept that price or counter it. Drivers can never create the
--    first ride_offers row for a ride the rider hasn't opened up.
-- 2. A rider's proposed amount (whether the initial broadcast or a later
--    counter) can never be less than 50% of the ride's estimated fare.
--
-- This repo doesn't track prior migrations (the schema lives in the linked
-- Supabase project), so this file only adds what's new and layers a
-- trigger on top of the existing ride_offers table rather than replacing
-- propose_ride_offer / respond_to_ride_offer, whose current bodies aren't
-- visible from here. Apply with `supabase db push` or paste into the SQL
-- editor, and double check the column/function names below still match
-- your live schema before running.

-- 1. New column for the rider's broadcast price.
alter table public.rides
  add column if not exists rider_proposed_fare_cents integer;

-- 2. RPC the rider calls to set/update their broadcast price.
create or replace function public.propose_rider_fare(
  ride_id_in uuid,
  amount_cents_in integer
) returns public.rides
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_ride public.rides;
  min_allowed integer;
begin
  select ceil(estimated_fare_cents * 0.5)::integer into min_allowed
  from public.rides
  where id = ride_id_in
    and rider_id = auth.uid()
    and status = 'requested';

  if min_allowed is null then
    raise exception 'Ride not found, not yours, or no longer accepting offers.';
  end if;

  if amount_cents_in < min_allowed then
    raise exception 'Your offer can''t be less than 50%% of the estimated fare.';
  end if;

  update public.rides
  set rider_proposed_fare_cents = amount_cents_in
  where id = ride_id_in
  returning * into updated_ride;

  return updated_ride;
end;
$$;

grant execute on function public.propose_rider_fare(uuid, integer) to authenticated;

-- 3. Trigger: enforce both rules directly on ride_offers, regardless of
--    which RPC (existing or future) performs the insert.
create or replace function public.enforce_negotiation_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ride_row public.rides;
  min_allowed integer;
  thread_exists boolean;
begin
  select * into ride_row from public.rides where id = new.ride_id;
  if ride_row.id is null then
    raise exception 'Ride % not found', new.ride_id;
  end if;

  if new.proposed_by = 'rider' then
    min_allowed := ceil(coalesce(ride_row.estimated_fare_cents, 0) * 0.5)::integer;
    if new.amount_cents < min_allowed then
      raise exception 'Rider offers can''t be less than 50%% of the estimated fare.';
    end if;
  elsif new.proposed_by = 'driver' then
    select exists(
      select 1 from public.ride_offers where ride_id = new.ride_id
    ) into thread_exists;

    if not thread_exists and ride_row.rider_proposed_fare_cents is null then
      raise exception 'Drivers can only respond to a negotiation the rider has already started.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_negotiation_rules on public.ride_offers;
create trigger trg_enforce_negotiation_rules
  before insert on public.ride_offers
  for each row execute function public.enforce_negotiation_rules();
