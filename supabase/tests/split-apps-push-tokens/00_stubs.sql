-- Stand-ins for what Supabase and the unversioned base schema (0001-0016,
-- not in this repo) provide: auth.uid(), the authenticated role, and the
-- minimal profiles/rides/push_config columns the notification migrations use.
-- Minimal stand-ins for what Supabase / the (unversioned) base schema provide.
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key,
  username text,
  role text not null default 'rider',
  push_token text,
  notify_push boolean default true,
  is_admin boolean not null default false,
  verification_status text default 'unverified',
  driver_license_number text, vehicle_make text, vehicle_model text, license_plate text
);
create table public.rides (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references public.profiles(id),
  driver_id uuid references public.profiles(id),
  status text not null,
  pickup_lat double precision, pickup_lng double precision,
  pickup_label text, pickup_address text,
  cancelled_by text, payment_status text, payment_method text default 'cash',
  final_fare_cents integer
);
create table public.push_config (key text primary key, value text);

-- set_driver_online lives in an unversioned base migration (0012); this
-- stub just mirrors its effect on the presence row the triggers read.
create function public.set_driver_online(online_in boolean, lat_in double precision, lng_in double precision)
returns void language plpgsql as $$
begin
  update public.driver_notification_presence set online = online_in where driver_id = auth.uid();
end $$;
