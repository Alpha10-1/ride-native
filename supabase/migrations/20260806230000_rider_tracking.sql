-- ---------------------------------------------------------------------
-- Fixes the RLS gap where a rider (or driver) couldn't read the other
-- party's profile row once matched on a ride. Prior to this migration,
-- "Users can view own profile" only allowed auth.uid() = id, so
-- getDriverContactInfo() in rides.ts silently returned null for riders
-- (select error swallowed, function returns null) even after a driver
-- accepted the ride.
--
-- This adds a second, additive SELECT policy: a user may also read a
-- profile row if that row's id is the counterparty (driver_id/rider_id)
-- on a ride they're part of, and the ride is at or past the point a
-- match exists (i.e. not still 'requested'/'scheduled' with no driver,
-- and not 'cancelled' before a driver was ever assigned). Completed/
-- cancelled rides remain visible too, since ride-complete and ride
-- history screens (rating card, receipts) still need to show who the
-- other party was.
--
-- Postgres RLS policies on the same table/command are OR'd together,
-- so this does not touch or replace "Users can view own profile" --
-- it only widens what's visible beyond self.
-- ---------------------------------------------------------------------

drop policy if exists "Matched ride parties can view each other" on public.profiles;

create policy "Matched ride parties can view each other"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.rides r
      where r.driver_id is not null
        and (
          (r.rider_id = auth.uid() and r.driver_id = public.profiles.id)
          or
          (r.driver_id = auth.uid() and r.rider_id = public.profiles.id)
        )
    )
  );
