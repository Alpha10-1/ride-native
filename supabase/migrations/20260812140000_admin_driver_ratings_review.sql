-- Admin-facing surface for driver ratings (see 20260808120000_driver_ratings.sql).
-- That migration added avg_rating / rating_count / flagged_for_review onto
-- profiles and auto-flags low-rated drivers, but gave admins no way to see
-- the queue or the underlying ratings — ride_ratings RLS only lets a rider
-- see their own submitted ratings and a driver see their own received ones.
-- These RPCs are the admin-only read path, plus a way to dismiss a flag
-- after manual review (e.g. the low average was a one-off run of bad luck
-- rather than a pattern worth acting on).

-- Summary list for the Ratings screen: defaults to just the flagged queue,
-- optionally searchable across all drivers with at least one rating.
create or replace function public.admin_list_driver_ratings(
  flagged_only_in boolean default true,
  search_in text default null
)
returns table (
  driver_id uuid,
  first_name text,
  last_name text,
  username text,
  avg_rating numeric,
  rating_count integer,
  flagged_for_review boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    p.id,
    p.first_name,
    p.last_name,
    p.username,
    p.avg_rating,
    p.rating_count,
    p.flagged_for_review
  from public.profiles p
  where p.is_driver = true
    and p.rating_count > 0
    and (not flagged_only_in or p.flagged_for_review = true)
    and (
      search_in is null
      or p.username ilike '%' || search_in || '%'
      or p.first_name ilike '%' || search_in || '%'
      or p.last_name ilike '%' || search_in || '%'
    )
  order by
    case when p.flagged_for_review then 0 else 1 end,
    p.avg_rating asc nulls last;
end;
$$;

grant execute on function public.admin_list_driver_ratings(boolean, text) to authenticated;

-- Individual ratings for one driver, for the detail/investigation view.
-- Unlike the driver's own "Ratings & Feedback" screen, admins reviewing a
-- flagged account get the rider's name too — they're investigating
-- whether the pattern is legitimate, not just displaying feedback.
create or replace function public.admin_get_driver_rating_detail(driver_id_in uuid)
returns table (
  id uuid,
  ride_id uuid,
  rider_first_name text,
  rider_last_name text,
  stars smallint,
  comment text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    rr.id,
    rr.ride_id,
    p.first_name,
    p.last_name,
    rr.stars,
    rr.comment,
    rr.created_at
  from public.ride_ratings rr
  join public.profiles p on p.id = rr.rider_id
  where rr.driver_id = driver_id_in
  order by rr.created_at desc;
end;
$$;

grant execute on function public.admin_get_driver_rating_detail(uuid) to authenticated;

-- Manually dismiss a flag after review. The flag will be recomputed (and
-- can be re-set) automatically the next time this driver receives a new
-- rating, via recalculate_driver_rating() — this only clears the current
-- state, it doesn't change the threshold logic or delete any ratings.
create or replace function public.admin_clear_driver_rating_flag(driver_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  update public.profiles
    set flagged_for_review = false
    where id = driver_id_in;
end;
$$;

grant execute on function public.admin_clear_driver_rating_flag(uuid) to authenticated;
