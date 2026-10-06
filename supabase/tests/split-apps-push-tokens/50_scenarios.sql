-- Push routing scenarios for 20261006120000_split_apps_push_tokens.sql.
-- Each block prints PASS or stops at the first failed assertion. Run via run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function as_user(u uuid) returns void language sql as $$ select set_config('test.uid', u::text, false) $$;
create or replace function last_tokens(title_in text) returns text[] language sql as $$
  select coalesce((select array_agg(t order by t) from (select distinct unnest(tokens) t from push_log where title = title_in) x), '{}')
$$;
create or replace function tok(p uuid) returns table(push_token text, rider_push_token text, driver_push_token text)
  language sql as $$ select push_token, rider_push_token, driver_push_token from profiles where id = p $$;

-- People. Pickup is central Johannesburg; "near" ~0.5 km, "far" = Pretoria (~55 km).
insert into profiles (id, username, role, is_driver, active_mode, push_token) values
  ('00000000-0000-0000-0000-00000000000a', 'legacy_driver', 'driver', true,  'driver', 'L_DRV'),     -- pre-split app, driving
  ('00000000-0000-0000-0000-00000000000b', 'legacy_dual',   'rider',  true,  'rider',  'L_DUAL'),    -- pre-split app, in rider mode
  ('00000000-0000-0000-0000-00000000000c', 'legacy_rider',  'rider',  false, 'rider',  'L_RIDER'),   -- pre-split app rider
  ('00000000-0000-0000-0000-000000000001', 'split_driver',  'driver', true,  'driver', null),        -- new driver app only
  ('00000000-0000-0000-0000-000000000002', 'split_dual',    'rider',  true,  'driver', null),        -- both new apps, driving
  ('00000000-0000-0000-0000-000000000003', 'split_far',     'driver', true,  'driver', null),
  ('00000000-0000-0000-0000-000000000004', 'split_offline', 'driver', true,  'driver', null),
  ('00000000-0000-0000-0000-000000000005', 'split_rider',   'rider',  false, 'rider',  null),        -- new rider app only
  ('00000000-0000-0000-0000-000000000006', 'muted_driver',  'driver', true,  'driver', null);
update profiles set notify_push = false where username = 'muted_driver';

do $$ begin
  perform as_user('00000000-0000-0000-0000-000000000001'); perform register_push_token('driver', 'S_DRV');
  perform as_user('00000000-0000-0000-0000-000000000002'); perform register_push_token('driver', 'S_DUAL_D');
                                                           perform register_push_token('rider',  'S_DUAL_R');
  perform as_user('00000000-0000-0000-0000-000000000003'); perform register_push_token('driver', 'S_FAR');
  perform as_user('00000000-0000-0000-0000-000000000004'); perform register_push_token('driver', 'S_OFF');
  perform as_user('00000000-0000-0000-0000-000000000005'); perform register_push_token('rider',  'R_TOK');
  perform as_user('00000000-0000-0000-0000-000000000006'); perform register_push_token('driver', 'S_MUTED');
end $$;

insert into driver_notification_presence (driver_id, lat, lng, online) values
  ('00000000-0000-0000-0000-00000000000a', -26.2041, 28.0473, true),
  ('00000000-0000-0000-0000-00000000000b', -26.2041, 28.0473, true),   -- stale "online" from the old ping bug
  ('00000000-0000-0000-0000-000000000001', -26.2060, 28.0490, true),
  ('00000000-0000-0000-0000-000000000002', -26.2050, 28.0480, true),
  ('00000000-0000-0000-0000-000000000003', -25.7479, 28.2293, true),
  ('00000000-0000-0000-0000-000000000004', -26.2045, 28.0475, false),
  ('00000000-0000-0000-0000-000000000006', -26.2045, 28.0475, true);

-- 1. Token bookkeeping
do $$ declare r record; begin
  select * into r from tok('00000000-0000-0000-0000-000000000002');
  assert r.push_token = 'S_DUAL_D', format('dual in driver mode: legacy push_token should follow driver app, got %s', r.push_token);
  select * into r from tok('00000000-0000-0000-0000-000000000005');
  assert r.push_token = 'R_TOK', 'rider-only: legacy push_token should be rider token';
  select * into r from tok('00000000-0000-0000-0000-00000000000a');
  assert r.push_token = 'L_DRV' and r.driver_push_token is null, 'legacy account untouched';
  raise warning 'PASS 1  per-app tokens stored; legacy push_token follows active app; legacy accounts untouched';
end $$;

-- 2. New ride request from a split-era rider
truncate push_log;
insert into rides (rider_id, status, pickup_lat, pickup_lng, pickup_label)
  values ('00000000-0000-0000-0000-000000000005', 'requested', -26.2041, 28.0473, 'Gandhi Square');
do $$ declare t text[] := last_tokens('New ride request'); begin
  assert t = array['L_DRV','S_DRV','S_DUAL_D'], format('request recipients wrong: %s', t);
  raise warning 'PASS 2  ride request -> nearby online drivers'' DRIVER app only %', t;
  raise warning '        (excluded: legacy dual in rider mode, far driver, offline driver, muted driver, all rider-app tokens)';
end $$;

-- 3. A dual-role person requesting a ride is never offered their own request
truncate push_log;
insert into rides (rider_id, status, pickup_lat, pickup_lng, pickup_label)
  values ('00000000-0000-0000-0000-000000000002', 'requested', -26.2041, 28.0473, 'Self');
do $$ declare t text[] := last_tokens('New ride request'); begin
  assert not ('S_DUAL_D' = any(t)), format('rider got own request: %s', t);
  raise warning 'PASS 3  own request not pushed to self %', t;
end $$;

-- 4. Ride lifecycle: rider events -> rider app, driver events -> driver app
truncate push_log;
update rides set driver_id = '00000000-0000-0000-0000-000000000001', status = 'accepted' where pickup_label = 'Gandhi Square';
do $$ begin
  assert last_tokens('Driver on the way') = array['R_TOK'], format('accepted -> %s', last_tokens('Driver on the way'));
end $$;
update rides set status = 'cancelled', cancelled_by = 'rider' where pickup_label = 'Gandhi Square';
do $$ begin
  assert last_tokens('Trip cancelled') = array['S_DRV'], format('rider cancel -> %s', last_tokens('Trip cancelled'));
  raise warning 'PASS 4  "Driver on the way" -> rider app; "rider cancelled" -> driver app';
end $$;

-- 5. Dual-role person opens the rider app (claims rider mode)
truncate push_log;
do $$ declare r record; begin
  perform as_user('00000000-0000-0000-0000-000000000002');
  perform switch_active_mode('rider');
  select * into r from tok('00000000-0000-0000-0000-000000000002');
  assert r.push_token = 'S_DUAL_R', format('after switch to rider, legacy push_token should be rider app: %s', r.push_token);
  assert (select not online from driver_notification_presence where driver_id = '00000000-0000-0000-0000-000000000002'), 'should be offline';
end $$;
insert into rides (rider_id, status, pickup_lat, pickup_lng, pickup_label)
  values ('00000000-0000-0000-0000-000000000005', 'requested', -26.2041, 28.0473, 'Second');
do $$ declare t text[] := last_tokens('New ride request'); begin
  assert t = array['L_DRV','S_DRV'], format('after dual went to rider app, requests should skip them: %s', t);
  raise warning 'PASS 5  switching to rider app: offline, no more requests, legacy token -> rider app';
end $$;

-- 6. ...and as a passenger their trip updates reach the rider app, while a
--    payout for an earlier trip they drove still reaches the driver app.
truncate push_log;
insert into rides (rider_id, driver_id, status, pickup_lat, pickup_lng, pickup_label)
  values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'accepted', -26.2, 28.0, 'DualRides');
update rides set status = 'driver_arrived' where pickup_label = 'DualRides';
insert into rides (rider_id, driver_id, status, payment_method, payment_status, pickup_label)
  values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'completed', 'card', 'pending', 'DualDrove');
update rides set payment_status = 'paid' where pickup_label = 'DualDrove';
do $$ begin
  assert last_tokens('Your driver has arrived') = array['S_DUAL_R'], format('arrived -> %s', last_tokens('Your driver has arrived'));
  assert last_tokens('Payment received') = array['S_DUAL_D'], format('payout -> %s', last_tokens('Payment received'));
  raise warning 'PASS 6  passenger updates -> rider app; driver payout -> driver app, regardless of current mode';
end $$;

-- 7. Legacy (pre-split app) accounts behave exactly as before
truncate push_log;
insert into rides (rider_id, driver_id, status, payment_method, payment_status, pickup_label)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000b', 'accepted', 'card', 'pending', 'Legacy');
update rides set status = 'driver_arrived', payment_status = 'paid' where pickup_label = 'Legacy';
do $$ begin
  assert last_tokens('Your driver has arrived') = array['L_RIDER'], 'legacy rider still notified';
  assert last_tokens('Payment received') = '{}', 'legacy driver in rider mode stays silenced, as before';
  raise warning 'PASS 7  legacy accounts: same token + same active_mode guard as before the split';
end $$;

-- 8. Shared phone: a token moves to whoever signed in last
do $$ declare r record; begin
  perform as_user('00000000-0000-0000-0000-00000000000c');   -- legacy rider updates to the new rider app on the same phone
  perform register_push_token('rider', 'R_TOK');             -- ...that split_rider used before
  select * into r from tok('00000000-0000-0000-0000-000000000005');
  assert r.rider_push_token is null and r.push_token is null, format('previous account should lose the token: %s', row_to_json(r));
  select * into r from tok('00000000-0000-0000-0000-00000000000c');
  assert r.rider_push_token = 'R_TOK' and r.push_token = 'R_TOK', format('new account owns it: %s', row_to_json(r));
  -- Legacy column on another account is cleared too (rider app reuses the pre-split app's token).
  update profiles set push_token = 'OLD_PHONE' where username = 'legacy_driver';
  perform as_user('00000000-0000-0000-0000-000000000005');
  perform register_push_token('rider', 'OLD_PHONE');
  assert (select push_token from profiles where username = 'legacy_driver') is null, 'legacy holder of token cleared';
  perform as_user('00000000-0000-0000-0000-00000000000c'); perform register_push_token('rider', 'L_RIDER');
  perform as_user('00000000-0000-0000-0000-000000000005'); perform register_push_token('rider', 'R_TOK');
  update profiles set push_token = 'L_DRV' where username = 'legacy_driver';
  raise warning 'PASS 8  token re-registered by another account is removed from the previous one';
end $$;

-- 9. Stale pre-split build writing push_token can't re-point a split-era account
do $$ begin
  update profiles set push_token = 'STALE' where id = '00000000-0000-0000-0000-000000000001';
  assert (select push_token from profiles where id = '00000000-0000-0000-0000-000000000001') = 'S_DRV', 'sync should override';
  raise warning 'PASS 9  direct push_token writes re-synced for split-era accounts';
end $$;

-- 10. Sign-out only clears this device's token
do $$ begin
  perform as_user('00000000-0000-0000-0000-000000000001');
  perform unregister_push_token('driver', 'SOME_OTHER_PHONE');
  assert (select driver_push_token from profiles where id = '00000000-0000-0000-0000-000000000001') = 'S_DRV', 'wrong token must not clear';
  perform unregister_push_token('driver', 'S_DRV');
  assert (select driver_push_token from profiles where id = '00000000-0000-0000-0000-000000000001') is null, 'cleared';
  assert (select push_token from profiles where id = '00000000-0000-0000-0000-000000000001') is null, 'legacy follows';
end $$;
truncate push_log;
insert into rides (rider_id, status, pickup_lat, pickup_lng, pickup_label)
  values ('00000000-0000-0000-0000-000000000005', 'requested', -26.2041, 28.0473, 'AfterSignOut');
do $$ begin
  assert not ('S_DRV' = any(last_tokens('New ride request'))), format('signed-out driver still pushed: %s', last_tokens('New ride request'));
  perform as_user('00000000-0000-0000-0000-000000000001');
  perform register_push_token('driver', 'S_DRV');
  raise warning 'PASS 10 unregister clears only a matching token; signed-out driver gets no requests';
end $$;

-- 11. Announcements by audience
truncate push_log;
insert into announcements (title, body, audience) values ('A-drivers', 'x', 'drivers'), ('A-riders', 'x', 'riders'), ('A-all', 'x', 'all');
do $$ begin
  assert last_tokens('A-drivers') = array['L_DRV','S_DRV','S_DUAL_D','S_FAR','S_OFF'], format('drivers: %s', last_tokens('A-drivers'));
  assert last_tokens('A-riders')  = array['L_DUAL','L_RIDER','R_TOK','S_DUAL_R'], format('riders: %s', last_tokens('A-riders'));
  assert last_tokens('A-all')     = array['L_DRV','L_DUAL','L_RIDER','R_TOK','S_DRV','S_DUAL_D','S_DUAL_R','S_FAR','S_OFF'], format('all: %s', last_tokens('A-all'));
  raise warning 'PASS 11 announcements: drivers -> driver apps, riders -> rider apps, all -> both (muted excluded)';
end $$;

-- 12. Invalid input / not signed in
do $$ begin
  perform set_config('test.uid', '', false);
  begin perform register_push_token('rider', 'X'); assert false, 'should reject anon'; exception when raise_exception then null; end;
  perform as_user('00000000-0000-0000-0000-000000000001');
  begin perform register_push_token('admin', 'X'); assert false, 'should reject bad app'; exception when raise_exception then null; end;
  begin perform register_push_token('driver', '  '); assert false, 'should reject blank'; exception when raise_exception then null; end;
  raise warning 'PASS 12 rejects anonymous callers, unknown apps, blank tokens';
end $$;
