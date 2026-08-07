-- Card verification switched from a Preauthorization hold+release to a
-- plain charge+refund (Preauthorization is gated behind a South-Africa-
-- only merchant eligibility flag that isn't approved yet — see
-- paystack-initialize-card-verification for the full explanation).
--
-- The old 'released' status no longer applies (nothing is held anymore);
-- the new terminal success state is 'refunded', once the R10 charge has
-- actually been refunded back to the rider's card.

alter table public.rider_card_verifications
  drop constraint if exists rider_card_verifications_status_check;

alter table public.rider_card_verifications
  add constraint rider_card_verifications_status_check
  check (status in ('pending', 'success', 'failed', 'released', 'refunded'));