-- Rider "Request my data" export — backs the Privacy screen's "Request
-- my data" row (previously a no-op button, src/screens/PrivacyScreen.tsx).
--
-- Unlike get_rider_spending (20260803160000_rider_spending_report.sql),
-- which is scoped to completed rides in a billing period for the
-- spending report, this returns EVERY ride the rider has ever been
-- party to — any status, no date bounds — since a data-access request
-- needs to be complete, not just the paid trips. It also joins in the
-- driver's name and vehicle details per ride (from profiles), which the
-- spending report doesn't need but a full data export does.
create or replace function public.get_rider_data_export()
returns table (
  trip_id uuid,
  status text,
  pickup_label text,
  pickup_address text,
  destination_label text,
  destination_address text,
  ride_tier text,
  requested_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  estimated_distance_km numeric,
  actual_distance_km numeric,
  estimated_fare_cents integer,
  final_fare_cents integer,
  cancellation_fee_cents integer,
  payment_method text,
  payment_status text,
  payment_reference text,
  driver_first_name text,
  driver_last_name text,
  driver_vehicle_make text,
  driver_vehicle_model text,
  driver_license_plate text
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
    select
      r.id,
      r.status::text,
      r.pickup_label,
      r.pickup_address,
      r.destination_label,
      r.destination_address,
      r.ride_tier::text,
      r.requested_at,
      r.accepted_at,
      r.completed_at,
      r.cancelled_at,
      r.cancelled_by::text,
      r.estimated_distance_km,
      r.actual_distance_km,
      r.estimated_fare_cents,
      r.final_fare_cents,
      r.cancellation_fee_cents,
      r.payment_method::text,
      r.payment_status::text,
      r.payment_reference,
      d.first_name,
      d.last_name,
      d.vehicle_make,
      d.vehicle_model,
      d.license_plate
    from public.rides r
    left join public.profiles d on d.id = r.driver_id
    where r.rider_id = auth.uid()
    order by r.requested_at desc;
end;
$$;

grant execute on function public.get_rider_data_export() to authenticated;
