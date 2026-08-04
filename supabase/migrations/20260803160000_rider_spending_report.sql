-- Rider spending reports — mirrors the shape of the existing
-- get_driver_statement RPC (not modified, this is a new sibling), but
-- scoped to the caller's own completed rides as rider, and includes
-- payment_method since the report needs to show how each trip was paid.
create or replace function public.get_rider_spending(
  period_start_in timestamptz,
  period_end_in timestamptz
)
returns table (
  trip_id uuid,
  completed_at timestamptz,
  pickup_address text,
  destination_address text,
  ride_tier text,
  final_fare_cents integer,
  payment_method text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  return query
    select r.id, r.completed_at, r.pickup_address, r.destination_address,
           r.ride_tier, r.final_fare_cents, r.payment_method
    from public.rides r
    where r.rider_id = auth.uid()
      and r.status = 'completed'
      and r.completed_at >= period_start_in
      and r.completed_at < period_end_in
    order by r.completed_at asc;
end;
$$;

grant execute on function public.get_rider_spending(timestamptz, timestamptz) to authenticated;
