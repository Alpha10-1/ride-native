-- Rider payment system (Paystack) ---------------------------------------
--
-- Replaces the simulated wallet top-up with real money, and gives riders
-- three ways to pay for a ride: wallet (pre-loaded balance), card (charged
-- per ride, either via a saved authorization or a fresh checkout), or cash
-- (collected by the driver, nothing processed digitally).
--
-- Wallet top-ups and card ride-payments follow the exact same pattern as
-- the existing driver subscription system: an Edge Function calls
-- Paystack's /transaction/initialize to get a checkout URL, the app opens
-- it with expo-web-browser, and paystack-webhook (already deployed) is
-- the only thing that ever marks a payment successful — the client never
-- gets to claim "I paid" on its own. This migration only adds new
-- branches to that webhook's logic (in the Edge Function code, not here)
-- and does not touch driver_subscriptions or any of its RPCs.
--
-- "Wallet should be cleared" — this migration wipes the simulated/demo
-- wallet balances and transaction history before real money starts
-- flowing through the same tables. This is a one-time data reset.
truncate table public.wallet_transactions;
update public.wallets set balance_cents = 0, updated_at = now();

-- -------------------------------------------------------------------
-- Rider payment method preference + per-ride selection
-- -------------------------------------------------------------------
alter table public.profiles
  add column if not exists preferred_payment_method text not null default 'cash'
    check (preferred_payment_method in ('wallet', 'card', 'cash'));

alter table public.rides
  add column if not exists payment_method text not null default 'cash'
    check (payment_method in ('wallet', 'card', 'cash')),
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed')),
  add column if not exists payment_reference text;

-- request_ride() is an existing RPC this migration does not touch. It
-- doesn't know about payment_method at all, so new rides would otherwise
-- always fall back to the column default ('cash'). This trigger fills in
-- the rider's actual preference at insert time instead; the app can then
-- still override it per-ride via set_ride_payment_method() below, right
-- after request_ride() returns (same "best-effort follow-up call"
-- pattern already used for proposeRiderFare).
create or replace function public.apply_preferred_payment_method()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pref text;
begin
  select preferred_payment_method into v_pref
    from public.profiles where id = new.rider_id;
  if v_pref is not null then
    new.payment_method := v_pref;
  end if;
  return new;
end;
$$;

drop trigger if exists rides_apply_preferred_payment_method on public.rides;
create trigger rides_apply_preferred_payment_method
  before insert on public.rides
  for each row execute function public.apply_preferred_payment_method();

-- -------------------------------------------------------------------
-- Saved cards (for one-tap card payments without a checkout each time)
-- -------------------------------------------------------------------
create table if not exists public.rider_cards (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  paystack_authorization_code text not null,
  card_last4 text,
  card_brand text,
  card_exp_month text,
  card_exp_year text,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  unique (rider_id, paystack_authorization_code)
);

create index if not exists rider_cards_rider_id_idx on public.rider_cards (rider_id);

alter table public.rider_cards enable row level security;

-- Riders can read their own saved cards. Inserts/updates happen only via
-- the paystack-webhook Edge Function using the service-role key (mirrors
-- driver_subscriptions) — there are deliberately no insert/update
-- policies here. Deletes go through delete_rider_card() below so removing
-- a card can't be confused with anything RLS needs to arbitrate.
drop policy if exists "riders read own cards" on public.rider_cards;
create policy "riders read own cards"
  on public.rider_cards for select
  using (auth.uid() = rider_id);

create or replace function public.delete_rider_card(card_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  delete from public.rider_cards where id = card_id_in and rider_id = auth.uid();
end;
$$;

grant execute on function public.delete_rider_card(uuid) to authenticated;

-- -------------------------------------------------------------------
-- Wallet top-up payments (real money, via Paystack checkout)
-- -------------------------------------------------------------------
create table if not exists public.wallet_topup_payments (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'ZAR',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  paystack_reference text unique not null,
  paystack_transaction_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists wallet_topup_payments_rider_id_idx
  on public.wallet_topup_payments (rider_id, created_at desc);

alter table public.wallet_topup_payments enable row level security;

drop policy if exists "riders read own topups" on public.wallet_topup_payments;
create policy "riders read own topups"
  on public.wallet_topup_payments for select
  using (auth.uid() = rider_id);

-- Atomically credits a rider's wallet and records the transaction. Called
-- only by paystack-webhook using the service-role key after Paystack
-- confirms a wallet top-up charge — never exposed to the app directly,
-- since it takes a rider_id and amount with no ownership check of its
-- own (that check already happened when the webhook matched the
-- reference to this rider's wallet_topup_payments row).
create or replace function public.credit_wallet_topup(
  rider_id_in uuid,
  amount_cents_in integer,
  description_in text default 'Wallet top-up'
)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallets%rowtype;
begin
  select * into v_wallet from public.wallets where profile_id = rider_id_in for update;
  if not found then
    raise exception 'No wallet found for rider %', rider_id_in;
  end if;

  update public.wallets
    set balance_cents = balance_cents + amount_cents_in,
        updated_at = now()
    where profile_id = rider_id_in
    returning * into v_wallet;

  insert into public.wallet_transactions (wallet_id, amount_cents, kind, description)
  values (v_wallet.id, amount_cents_in, 'topup', description_in);

  return v_wallet;
end;
$$;

-- Deliberately NOT granted to authenticated/anon — this must only run
-- with the service-role key from paystack-webhook, since it trusts its
-- rider_id_in argument completely.
revoke all on function public.credit_wallet_topup(uuid, integer, text) from public;
grant execute on function public.credit_wallet_topup(uuid, integer, text) to service_role;

-- -------------------------------------------------------------------
-- Per-ride payments (card charges only — wallet/cash settle instantly
-- inside settle_ride_payment() below and don't need a Paystack round
-- trip, but still get a row here for a consistent audit trail... no,
-- keeping this table to card attempts only keeps it simple: wallet and
-- cash outcomes are already fully recorded on rides.payment_status
-- plus, for wallet, the usual wallet_transactions row.)
-- -------------------------------------------------------------------
create table if not exists public.ride_payments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null,
  currency text not null default 'ZAR',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  paystack_reference text unique not null,
  paystack_transaction_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists ride_payments_ride_id_idx on public.ride_payments (ride_id, created_at desc);

alter table public.ride_payments enable row level security;

drop policy if exists "riders read own ride payments" on public.ride_payments;
create policy "riders read own ride payments"
  on public.ride_payments for select
  using (auth.uid() = rider_id);

drop policy if exists "drivers read their ride payments" on public.ride_payments;
create policy "drivers read their ride payments"
  on public.ride_payments for select
  using (exists (
    select 1 from public.rides
    where rides.id = ride_payments.ride_id and rides.driver_id = auth.uid()
  ));

-- -------------------------------------------------------------------
-- Rider-facing RPCs
-- -------------------------------------------------------------------
create or replace function public.set_preferred_payment_method(method_in text)
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
  if method_in not in ('wallet', 'card', 'cash') then
    raise exception 'Invalid payment method: %', method_in;
  end if;

  update public.profiles set preferred_payment_method = method_in
    where id = auth.uid()
    returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.set_preferred_payment_method(text) to authenticated;

-- Lets a rider change how a specific ride will be paid for, any time
-- before it's completed or cancelled. Used right after request_ride()
-- returns, when the rider picked something other than their saved
-- default for this one trip.
create or replace function public.set_ride_payment_method(ride_id_in uuid, method_in text)
returns public.rides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.rides%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if method_in not in ('wallet', 'card', 'cash') then
    raise exception 'Invalid payment method: %', method_in;
  end if;

  select * into v_ride from public.rides where id = ride_id_in;
  if not found then
    raise exception 'Ride not found.';
  end if;
  if auth.uid() <> v_ride.rider_id then
    raise exception 'Not authorized for this ride.';
  end if;
  if v_ride.status in ('completed', 'cancelled') then
    raise exception 'Cannot change payment method after the ride has ended.';
  end if;

  update public.rides
    set payment_method = method_in
    where id = ride_id_in
    returning * into v_ride;

  return v_ride;
end;
$$;

grant execute on function public.set_ride_payment_method(uuid, text) to authenticated;

-- Settles a completed ride's fare against whatever payment_method it was
-- tagged with. Callable by either party on the ride (driver marks a trip
-- complete; rider's ride-complete screen may also call this so it works
-- regardless of whose device gets there first — it's idempotent).
--
--   cash   -> marks paid immediately, nothing to process.
--   wallet -> atomically debits the rider's wallet if there's enough
--             balance; marks 'failed' (not blocking) if not, so the app
--             can prompt the rider to top up or switch methods.
--   card   -> marks 'pending' only. The actual charge happens via the
--             paystack-charge-ride-card Edge Function (uses a saved
--             card) or paystack-initialize-ride-checkout (fresh
--             checkout), called by the client right after this returns.
create or replace function public.settle_ride_payment(ride_id_in uuid)
returns table (
  payment_status text,
  method text,
  amount_cents integer,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.rides%rowtype;
  v_amount integer;
  v_wallet public.wallets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_ride from public.rides where id = ride_id_in;
  if not found then
    raise exception 'Ride not found.';
  end if;

  if auth.uid() <> v_ride.rider_id and auth.uid() <> v_ride.driver_id then
    raise exception 'Not authorized for this ride.';
  end if;

  if v_ride.status <> 'completed' then
    raise exception 'Ride is not completed yet.';
  end if;

  if v_ride.payment_status = 'paid' then
    return query select 'paid'::text, v_ride.payment_method, coalesce(v_ride.final_fare_cents, 0), 'Already paid.'::text;
    return;
  end if;

  v_amount := coalesce(v_ride.final_fare_cents, 0);

  if v_amount <= 0 then
    update public.rides set payment_status = 'paid' where id = ride_id_in;
    return query select 'paid'::text, v_ride.payment_method, 0, 'No charge required.'::text;
    return;
  end if;

  if v_ride.payment_method = 'cash' then
    update public.rides set payment_status = 'paid' where id = ride_id_in;
    return query select 'paid'::text, 'cash'::text, v_amount, 'Collected in cash.'::text;
    return;
  end if;

  if v_ride.payment_method = 'wallet' then
    select * into v_wallet from public.wallets where profile_id = v_ride.rider_id for update;

    if not found or v_wallet.balance_cents < v_amount then
      update public.rides set payment_status = 'failed' where id = ride_id_in;
      return query select 'failed'::text, 'wallet'::text, v_amount, 'Insufficient wallet balance.'::text;
      return;
    end if;

    update public.wallets
      set balance_cents = balance_cents - v_amount, updated_at = now()
      where profile_id = v_ride.rider_id;

    insert into public.wallet_transactions (wallet_id, amount_cents, kind, description)
    values (v_wallet.id, -v_amount, 'ride_charge', 'Ride fare');

    update public.rides set payment_status = 'paid' where id = ride_id_in;
    return query select 'paid'::text, 'wallet'::text, v_amount, 'Paid from wallet.'::text;
    return;
  end if;

  -- card: the Edge Function does the actual charge; this just stakes out
  -- 'pending' so the UI can show a spinner while that happens.
  update public.rides set payment_status = 'pending' where id = ride_id_in;
  return query select 'pending'::text, 'card'::text, v_amount, 'Charging your card...'::text;
end;
$$;

grant execute on function public.settle_ride_payment(uuid) to authenticated;
