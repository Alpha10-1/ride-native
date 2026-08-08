-- Fix 1: stub_add_earning was throwing "column reference \"id\" is
-- ambiguous" on the driver Earnings screen's "Simulate Completed Trip"
-- button. Re-declared here following the same safe, unambiguous
-- %rowtype-variable pattern already used by credit_wallet_topup (see
-- 20260802120000_rider_payments.sql) instead of relying on bare column
-- references/OUT params that collide with table column names.
create or replace function public.stub_add_earning(
  amount_cents_in integer,
  description_in text default 'Stub trip earning'
)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_wallet from public.wallets where profile_id = auth.uid() for update;
  if not found then
    raise exception 'No wallet found for this account.';
  end if;

  update public.wallets
    set balance_cents = balance_cents + amount_cents_in,
        updated_at = now()
    where profile_id = auth.uid()
    returning * into v_wallet;

  insert into public.wallet_transactions (wallet_id, amount_cents, kind, description)
  values (v_wallet.id, amount_cents_in, 'earning', description_in);

  return v_wallet;
end;
$$;

grant execute on function public.stub_add_earning(integer, text) to authenticated;

-- Fix 2: go_online_test_checked correctly gated "go online" on the
-- test_mode capability, but then always delegated to go_online_checked,
-- which ALSO enforces the real driver-subscription gate — so a test-mode
-- driver with "go_online" enabled still got blocked by "Subscription
-- required", since test accounts have no real subscription. Test mode
-- should stand in for the subscription check entirely once the
-- capability check has passed, not stack on top of it.
create or replace function public.go_online_test_checked(
  lat_in double precision default null,
  lng_in double precision default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test_mode boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if not public.driver_has_test_capability(auth.uid(), 'go_online') then
    raise exception 'TEST_MODE_RESTRICTED: Going online has not been enabled for your test account yet.';
  end if;

  select test_mode into v_test_mode from public.profiles where id = auth.uid();

  if v_test_mode then
    -- Capability check above already stands in for the subscription
    -- gate for test accounts — go straight to flipping the driver
    -- online instead of also running the real subscription check.
    perform public.set_driver_online(online_in => true, lat_in => lat_in, lng_in => lng_in);
  else
    perform public.go_online_checked(lat_in, lng_in);
  end if;
end;
$$;

grant execute on function public.go_online_test_checked(double precision, double precision) to authenticated;
