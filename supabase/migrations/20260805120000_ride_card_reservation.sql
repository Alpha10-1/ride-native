-- Ride card reservation (Paystack Preauthorization) -----------------------
--
-- When a driver accepts a ride paid by card, the estimated fare is now
-- placed on hold on the rider's saved card via Paystack's Preauthorization
-- API (South Africa / ZAR only: reserve_authorization -> capture/release)
-- rather than waiting until the ride completes to attempt a charge. Wallet
-- and cash payments are completely unaffected by this migration.
--
-- The actual Paystack HTTP calls happen in Edge Functions, same pattern as
-- every other payment flow in this app:
--   paystack-reserve-ride-card   -- called right after accept_ride()
--   paystack-charge-ride-card    -- updated to capture the hold at
--                                    completion instead of a fresh charge,
--                                    when a reservation exists
--   paystack-release-ride-card   -- called on cancellation, to free the
--                                    hold instead of leaving it to expire
-- This migration only adds the columns/status values those functions read
-- and write, plus a rider-facing read of their own reservation state.

-- payment_status gains 'reserved' — funds held on the card, not yet
-- captured. Existing values (unpaid/pending/paid/failed) are untouched.
alter table public.rides drop constraint if exists rides_payment_status_check;
alter table public.rides
  add constraint rides_payment_status_check
  check (payment_status in ('unpaid', 'pending', 'reserved', 'paid', 'failed'));

alter table public.rides
  add column if not exists card_reservation_reference text,
  add column if not exists card_reservation_amount_cents integer,
  add column if not exists card_reservation_status text not null default 'none'
    check (card_reservation_status in ('none', 'pending', 'reserved', 'captured', 'released', 'failed'));

create index if not exists rides_card_reservation_reference_idx
  on public.rides (card_reservation_reference) where card_reservation_reference is not null;

-- ride_payments already logs every card charge attempt; extend it to log
-- reservation attempts too (kind = 'reservation') alongside the existing
-- charge rows (kind = 'charge'), and allow the 'reserved'/'released'
-- statuses reservations can be in.
alter table public.ride_payments
  add column if not exists kind text not null default 'charge'
    check (kind in ('charge', 'reservation'));

alter table public.ride_payments drop constraint if exists ride_payments_status_check;
alter table public.ride_payments
  add constraint ride_payments_status_check
  check (status in ('pending', 'success', 'failed', 'reserved', 'released'));
