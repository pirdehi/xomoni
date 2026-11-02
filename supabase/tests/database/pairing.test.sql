-- Pairing the extension with a one-time code, and what its device token may do (#38, #39, #40; ADR-0018).
-- Proves the negative cases: no code without a session, a code works once and only while fresh, a token
-- reports only for its own device, the secret tables are closed to everyone. Run with `supabase test db`.
begin;
select plan(27);

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-00000000004a', 'flo@pair.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000004b', 'gus@pair.test.xomoni.com', 'authenticated', 'authenticated');

-- ── Codes come only from a signed-in person ───────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.create_pairing_code()', '42501', null, 'anon cannot create a code');
select throws_ok('select * from public.device_pairings', '42501', null, 'anon cannot read codes');
select throws_ok('select * from public.device_tokens', '42501', null, 'anon cannot read tokens');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-00000000004a", "role": "authenticated"}';
select throws_ok('select * from public.device_pairings', '42501', null, 'a signed-in person cannot read codes');
select throws_ok('select * from public.device_tokens', '42501', null, 'a signed-in person cannot read tokens');

-- In one transaction now() doesn't move, so `n` keeps the order the codes were made in.
create temporary table codes (n serial, code text, expires_at timestamptz) on commit drop;
grant all on codes to anon, authenticated;
grant usage on sequence codes_n_seq to anon, authenticated;
insert into codes (code, expires_at) select * from public.create_pairing_code();
select matches((select code from codes), '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$', 'a code is ten Crockford characters');
select ok((select expires_at between now() + interval '9 minutes' and now() + interval '11 minutes' from codes),
  'a code lasts ten minutes');

-- A second code replaces the first.
insert into codes (code, expires_at) select * from public.create_pairing_code();
reset role;
select is((select count(*)::int from public.device_pairings
  where user_id = '00000000-0000-4000-a000-00000000004a'), 1, 'one code per person at a time');
select isnt((select code_hash from public.device_pairings limit 1), convert_to((select code from codes order by n desc limit 1), 'UTF8'),
  'codes are stored hashed');

-- ── The extension pairs with the code, once ─────────────────────────────────────────────────────
set local role anon;
select throws_ok($$ select * from public.pair_device('AAAAA-AAAAA', 'Chrome', '0.3.0') $$, 'P0001',
  'This code is not valid. Get a new one on xomoni.com.', 'a wrong code is refused');
select throws_ok(format($$ select * from public.pair_device(%L, 'Chrome', '0.3.0') $$,
  (select code from codes order by n limit 1)), 'P0001', null, 'the replaced first code is refused');

create temporary table paired (device_id uuid, token text) on commit drop;
grant all on paired to anon, authenticated;
insert into paired select * from public.pair_device(
  lower(replace((select code from codes order by n desc limit 1), '-', '')), ' Chrome on macOS ', '0.3.0');
select is((select count(*)::int from paired), 1, 'the latest code pairs, typed in lower case without the dash');
select matches((select token from paired), '^[0-9a-f]{64}$', 'the token is 256 random bits');
select throws_ok(format($$ select * from public.pair_device(%L, 'Chrome', '0.3.0') $$,
  (select code from codes order by n desc limit 1)), 'P0001', null, 'a used code is refused');

reset role;
select results_eq($$ select user_id, name, extension_version from public.devices where id = (select device_id from paired) $$,
  $$ values ('00000000-0000-4000-a000-00000000004a'::uuid, 'Chrome on macOS', '0.3.0') $$,
  'the device belongs to the person who made the code, its name trimmed');
select isnt((select token_hash from public.device_tokens where device_id = (select device_id from paired)),
  convert_to((select token from paired), 'UTF8'), 'tokens are stored hashed');

-- An expired code is refused.
update public.device_pairings set expires_at = now() - interval '1 second';
insert into public.device_pairings (user_id, code_hash, expires_at)
values ('00000000-0000-4000-a000-00000000004b', extensions.digest('EXPIRED000', 'sha256'), now() - interval '1 second');
set local role anon;
select throws_ok($$ select * from public.pair_device('EXPIR-ED000', 'Chrome', '0.3.0') $$, 'P0001', null,
  'an expired code is refused');
reset role;

-- ── The token reports for its own device only ───────────────────────────────────────────────────
set local role anon;
select throws_ok($$ select public.device_report('not-a-token', '0.3.0', '[]') $$, 'P0001',
  'This browser is not connected to a Xomoni account.', 'an unknown token is refused');
select lives_ok(format($$ select public.device_report(%L, '0.3.1', '[]') $$, (select token from paired)),
  'a heartbeat with no jobs');
select lives_ok(format($$ select public.device_report(%L, '0.3.1', %L) $$, (select token from paired),
  '[{"local_id": "job-1", "x_handle": "flo", "kind": "cleanup", "title": "Delete posts older than Jan 1, 2018",
     "state": "running", "matched": 39, "done": 3, "risk_level": 0, "started_at": "2026-11-02T08:00:00Z"}]'),
  'a report with one job');
select lives_ok(format($$ select public.device_report(%L, '0.3.1', %L) $$, (select token from paired),
  '[{"local_id": "job-1", "x_handle": "flo", "kind": "cleanup", "title": "Delete posts older than Jan 1, 2018",
     "state": "completed", "matched": 39, "done": 39, "risk_level": 0}]'),
  'a later report of the same job');
select throws_ok(format($$ select public.device_report(%L, '0.3.1', %L) $$, (select token from paired),
  (select jsonb_agg(jsonb_build_object('local_id', 'j' || n)) from generate_series(1, 51) n)), '22023', null,
  'more than 50 jobs in one report are refused');
select throws_ok(format($$ select public.device_report(%L, '0.3.1', %L) $$, (select token from paired),
  '[{"local_id": "job-2", "x_handle": "flo", "kind": "cleanup", "title": "x", "state": "exploded"}]'),
  '23514', null, 'a job in a state the dashboard does not know is refused');

reset role;
select results_eq($$ select state, done, user_id from public.jobs where local_id = 'job-1' $$,
  $$ values ('completed', 39, '00000000-0000-4000-a000-00000000004a'::uuid) $$,
  'the report updates one row, owned by the device''s person');
select is((select extension_version from public.devices where id = (select device_id from paired)), '0.3.1',
  'the heartbeat records the extension version');

-- ── The extension disconnects itself ────────────────────────────────────────────────────────────
set local role anon;
select lives_ok(format($$ select public.unpair_device(%L) $$, (select token from paired)), 'unpair');
reset role;
select is((select count(*)::int from public.devices where id = (select device_id from paired)), 0,
  'the device and its jobs are gone after unpairing');

select * from finish();
rollback;
