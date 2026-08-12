-- Admin-facing listing for driver payout requests (see
-- 20260812120000_driver_payout_requests.sql). Joins profiles for the
-- driver's name/username so the admin dashboard doesn't need row-level
-- access to the profiles table itself.

create or replace function public.admin_list_payout_requests(status_in text default null)
returns table (
  id uuid,
  driver_id uuid,
  driver_first_name text,
  driver_last_name text,
  driver_username text,
  amount_cents integer,
  fee_cents integer,
  status text,
  bank_name text,
  bank_account_holder text,
  bank_account_number text,
  bank_branch_code text,
  admin_notes text,
  requested_at timestamptz,
  processed_at timestamptz
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
    pr.id,
    pr.driver_id,
    p.first_name,
    p.last_name,
    p.username,
    pr.amount_cents,
    pr.fee_cents,
    pr.status,
    pr.bank_name,
    pr.bank_account_holder,
    pr.bank_account_number,
    pr.bank_branch_code,
    pr.admin_notes,
    pr.requested_at,
    pr.processed_at
  from public.payout_requests pr
  join public.profiles p on p.id = pr.driver_id
  where status_in is null or pr.status = status_in
  order by
    case pr.status when 'pending' then 0 else 1 end,
    pr.requested_at desc;
end;
$$;

grant execute on function public.admin_list_payout_requests(text) to authenticated;
