-- Rider banking details — distinct from the card-on-file used for ride
-- payments (rider_cards / Paystack authorizations). This is a bank
-- account riders can record for refunds/payouts, editable directly by
-- them, not something Paystack ever writes to.

alter table public.profiles
  add column if not exists bank_name text,
  add column if not exists bank_account_holder text,
  add column if not exists bank_account_number text,
  add column if not exists bank_branch_code text;

create or replace function public.update_bank_details(
  bank_name_in text,
  account_holder_in text,
  account_number_in text,
  branch_code_in text
)
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
  if trim(coalesce(bank_name_in, '')) = '' then
    raise exception 'Bank name is required.';
  end if;
  if trim(coalesce(account_holder_in, '')) = '' then
    raise exception 'Account holder name is required.';
  end if;
  if trim(coalesce(account_number_in, '')) = '' then
    raise exception 'Account number is required.';
  end if;

  update public.profiles
    set bank_name = trim(bank_name_in),
        bank_account_holder = trim(account_holder_in),
        bank_account_number = trim(account_number_in),
        bank_branch_code = nullif(trim(coalesce(branch_code_in, '')), '')
    where id = auth.uid()
    returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.update_bank_details(text, text, text, text) to authenticated;

create or replace function public.clear_bank_details()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  update public.profiles
    set bank_name = null, bank_account_holder = null, bank_account_number = null, bank_branch_code = null
    where id = auth.uid();
end;
$$;

grant execute on function public.clear_bank_details() to authenticated;
