-- Driver subscription billing (Paystack) -------------------------------
--
-- Drivers pay a monthly platform fee to go online: R120/month for their
-- first 3 billing cycles, then R150/month after that. Billing is fully
-- automatic — after the first checkout, Paystack keeps a reusable card
-- authorization on file, and the paystack-charge-recurring Edge Function
-- (run on a daily schedule, see bottom of this file) charges it every
-- month with no action needed from the driver.
--
-- If a monthly charge fails, the driver isn't blocked immediately — they
-- get `grace_period_days` (default 5) to sort out their card before
-- go_online_checked() below starts refusing to let them go online.
--
-- Nothing here writes to whatever table/RPC already tracks live
-- online/offline presence (set_driver_online) — this migration only adds
-- new tables/functions and a thin wrapper function that calls the
-- existing set_driver_online RPC after a subscription check passes, so it
-- can't break existing presence behavior.

create table if not exists public.driver_subscriptions (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'inactive'
    check (status in ('inactive', 'active', 'past_due', 'blocked', 'canceled')),

  paystack_customer_code text,
  paystack_authorization_code text,
  card_last4 text,
  card_brand text,

  -- Number of successful monthly charges so far. Cycles 0, 1, 2 (the
  -- first 3) bill at R120; cycle 3 onward bills at R150. See
  -- driver_subscription_amount_cents() below.
  billing_cycle_count integer not null default 0,

  current_period_start timestamptz,
  current_period_end timestamptz,

  grace_period_days integer not null default 5,
  grace_period_ends_at timestamptz,

  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  billing_cycle_number integer not null,
  amount_cents integer not null,
  currency text not null default 'ZAR',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  paystack_reference text unique not null,
  paystack_transaction_id text,
  failure_reason text,
  attempted_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists driver_subscription_payments_driver_id_idx
  on public.driver_subscription_payments (driver_id, attempted_at desc);

alter table public.driver_subscriptions enable row level security;
alter table public.driver_subscription_payments enable row level security;

-- Drivers can read their own subscription + payment history. All writes
-- happen through Edge Functions using the service-role key (Paystack
-- webhook, initialize, recurring charge) — never directly from the app —
-- so there are deliberately no insert/update policies for authenticated
-- users here.
drop policy if exists "drivers read own subscription" on public.driver_subscriptions;
create policy "drivers read own subscription"
  on public.driver_subscriptions for select
  using (auth.uid() = driver_id);

drop policy if exists "drivers read own subscription payments" on public.driver_subscription_payments;
create policy "drivers read own subscription payments"
  on public.driver_subscription_payments for select
  using (auth.uid() = driver_id);

-- Pricing: R120/month for the first 3 cycles, R150/month after.
-- Amounts are in cents (ZAR's smallest unit), matching wallet_transactions
-- / final_fare_cents elsewhere in this project.
create or replace function public.driver_subscription_amount_cents(cycle_count integer)
returns integer
language sql
immutable
as $$
  select case when cycle_count < 3 then 12000 else 15000 end;
$$;

-- Returns whether a driver is currently allowed to go online, and why
-- not if not. Used by go_online_checked() below, and by the app to show
-- subscription status/paywall UI ahead of time.
create or replace function public.get_driver_subscription_gate(driver_id_in uuid)
returns table (
  allowed boolean,
  status text,
  reason text,
  next_amount_cents integer,
  grace_period_ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.driver_subscriptions%rowtype;
begin
  select * into v_sub from public.driver_subscriptions where driver_id = driver_id_in;

  if not found or v_sub.status = 'inactive' then
    return query select
      false,
      coalesce(v_sub.status, 'inactive'),
      'Set up your monthly driver subscription to start receiving ride requests.'::text,
      public.driver_subscription_amount_cents(0),
      null::timestamptz;
    return;
  end if;

  if v_sub.status = 'active' then
    return query select
      true, v_sub.status, null::text,
      public.driver_subscription_amount_cents(v_sub.billing_cycle_count),
      v_sub.grace_period_ends_at;
    return;
  end if;

  if v_sub.status = 'past_due' then
    return query select
      true, v_sub.status,
      'Your last subscription payment failed. Update your card before the grace period ends.'::text,
      public.driver_subscription_amount_cents(v_sub.billing_cycle_count),
      v_sub.grace_period_ends_at;
    return;
  end if;

  -- blocked or canceled
  return query select
    false, v_sub.status,
    case when v_sub.status = 'blocked'
      then 'Your account is blocked for non-payment. Update your card to go online again.'
      else 'Your driver subscription is canceled. Resubscribe to go online.'
    end,
    public.driver_subscription_amount_cents(greatest(v_sub.billing_cycle_count, 0)),
    v_sub.grace_period_ends_at;
end;
$$;

grant execute on function public.get_driver_subscription_gate(uuid) to authenticated;

-- Convenience wrapper so the app calls one RPC for "my" status without
-- ever passing its own id (can't accidentally query someone else's).
create or replace function public.get_my_subscription_gate()
returns table (
  allowed boolean,
  status text,
  reason text,
  next_amount_cents integer,
  grace_period_ends_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select * from public.get_driver_subscription_gate(auth.uid());
$$;

grant execute on function public.get_my_subscription_gate() to authenticated;

-- Wraps the existing set_driver_online RPC with a subscription check, so
-- the paywall can't be bypassed by calling the online toggle directly
-- from a modified client. Going offline never needs gating, so the app
-- keeps calling set_driver_online(false, ...) directly for that.
--
-- This assumes set_driver_online's parameter names are online_in / lat_in
-- / lng_in, which is what src/lib/presence.ts already calls in production
-- — it does not touch or redefine set_driver_online itself.
create or replace function public.go_online_checked(lat_in double precision default null, lng_in double precision default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_gate from public.get_driver_subscription_gate(auth.uid());

  if not v_gate.allowed then
    raise exception '%', coalesce(v_gate.reason, 'Your driver subscription is not active.');
  end if;

  perform public.set_driver_online(online_in => true, lat_in => lat_in, lng_in => lng_in);
end;
$$;

grant execute on function public.go_online_checked(double precision, double precision) to authenticated;

create or replace function public.touch_driver_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists driver_subscriptions_touch_updated_at on public.driver_subscriptions;
create trigger driver_subscriptions_touch_updated_at
  before update on public.driver_subscriptions
  for each row execute function public.touch_driver_subscriptions_updated_at();

-- ---------------------------------------------------------------------
-- Scheduling paystack-charge-recurring
-- ---------------------------------------------------------------------
-- This migration does NOT schedule the cron job itself, because that
-- needs a project URL + a shared secret that only exist once you've
-- deployed the Edge Function (same reasoning as send-push's
-- FUNCTION_SECRET — see supabase/functions/index.ts). Once deployed:
--
--   1. supabase functions deploy paystack-charge-recurring
--   2. supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxx
--   3. supabase secrets set CRON_SECRET=<any long random string>
--   4. In the SQL editor (or via a follow-up migration), enable pg_cron
--      and pg_net, then schedule a daily call:
--
--      create extension if not exists pg_cron;
--      create extension if not exists pg_net;
--
--      select cron.schedule(
--        'paystack-charge-recurring-daily',
--        '0 6 * * *',  -- 06:00 UTC = 08:00 SAST, once a day
--        $$
--        select net.http_post(
--          url := 'https://<project-ref>.supabase.co/functions/v1/paystack-charge-recurring',
--          headers := jsonb_build_object(
--            'Authorization', 'Bearer <the CRON_SECRET you set above>',
--            'Content-Type', 'application/json'
--          ),
--          body := '{}'::jsonb
--        );
--        $$
--      );
--
--   Alternatively, skip pg_cron entirely and schedule the same daily
--   POST from the Supabase Dashboard under Edge Functions → Cron, or
--   from any external scheduler (e.g. GitHub Actions cron) — the
--   function itself doesn't care who calls it, only that the
--   Authorization header matches CRON_SECRET.
