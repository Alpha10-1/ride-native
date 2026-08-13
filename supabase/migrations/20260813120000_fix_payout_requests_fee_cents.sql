-- Patch: the live payout_requests table was created before fee_cents was
-- added to 20260812120000_driver_payout_requests.sql (or the earlier
-- `create table if not exists` no-op'd against an existing table), so the
-- column never made it into the live schema. This safely backfills it
-- without touching anything else.

alter table public.payout_requests
  add column if not exists fee_cents integer not null default 500;

alter table public.payout_requests
  drop constraint if exists payout_requests_fee_cents_check;

alter table public.payout_requests
  add constraint payout_requests_fee_cents_check check (fee_cents >= 0);
