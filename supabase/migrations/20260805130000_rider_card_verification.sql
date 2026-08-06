-- Card verification (Paystack Preauthorization, hold + immediate release) -
--
-- Replaces "Add card" piggybacking on a real R10 wallet top-up (which
-- actually charged the rider and never saved the resulting card, since
-- the wallet-topup webhook branch never wrote to rider_cards). Riders
-- should be able to add a card without being charged anything at all.
--
-- Uses the same Preauthorization API as ride fund reservations
-- (see 20260805120000_ride_card_reservation.sql), but for card
-- verification the hold is placed and then released immediately once
-- confirmed — nothing is ever actually captured, so no money moves.

create table if not exists public.rider_card_verifications (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null,
  currency text not null default 'ZAR',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'released')),
  paystack_reference text unique not null,
  paystack_transaction_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists rider_card_verifications_rider_id_idx
  on public.rider_card_verifications (rider_id, created_at desc);

alter table public.rider_card_verifications enable row level security;

drop policy if exists "riders read own card verifications" on public.rider_card_verifications;
create policy "riders read own card verifications"
  on public.rider_card_verifications for select
  using (auth.uid() = rider_id);
