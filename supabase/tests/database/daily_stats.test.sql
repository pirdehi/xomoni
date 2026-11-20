-- Daily numbers in the cloud, by the person's choice (#250, ADR-0026). Proves the negative cases: nothing is stored
-- while the choice is off, a row carries only counts in range, days are recent, each person reads only their own,
-- nobody writes the table directly, and turning the choice off deletes every row. Run with `supabase test db`.
begin;
select plan(28);

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-0000000000d1', 'dee@daily.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000d2', 'eli@daily.test.xomoni.com', 'authenticated', 'authenticated');

-- A connected browser for Dee, with a token as pairing would make it.
insert into public.devices (id, user_id, name, extension_version)
values ('00000000-0000-4000-b000-0000000000d1', '00000000-0000-4000-a000-0000000000d1', 'Chrome', '0.3.0');
insert into public.device_tokens (device_id, token_hash)
values ('00000000-0000-4000-b000-0000000000d1', extensions.digest('dee-token', 'sha256'));

create temporary table day_rows (r jsonb) on commit drop;
grant all on day_rows to anon, authenticated;
insert into day_rows values (jsonb_build_object(
  'x_handle', 'dee_x', 'day', current_date::text,
  'followers', 120, 'following', 80, 'posts_total', 900, 'likes_total', null,
  'posted_posts', 2, 'posted_replies', 5, 'posted_reposts', 1, 'posted_quotes', 0,
  'received_likes', 40, 'received_replies', 6, 'received_reposts', 3, 'received_quotes', 1, 'received_views', 5200,
  'observed_posts', 30, 'posts_with_likes', 12, 'replies_with_likes', 4,
  'removed_posts', 7, 'removed_replies', 0, 'removed_reposts', 0, 'removed_likes', 15));

-- ── Off by default: nothing is stored ────────────────────────────────────────────────────────────
set local role anon;
select throws_ok($$ select public.device_report_stats('dee-token', jsonb_build_array((select r from day_rows))) $$,
  'P0001', 'Daily numbers are off for this account.', 'nothing is stored before the person turns the numbers on');
select is((public.device_report('dee-token', '0.3.0') ->> 'stats')::boolean, false,
  'the heartbeat tells the extension the numbers are off');

-- ── Turned on in the extension, the numbers are stored ───────────────────────────────────────────
select is(public.device_set_daily_stats('dee-token', true), true, 'the extension turns them on for its account');
select throws_ok($$ select public.device_set_daily_stats('not-a-token', true) $$, 'P0001', null,
  'an unknown token turns nothing on');
select is((public.device_report('dee-token', '0.3.0') ->> 'stats')::boolean, true, 'the heartbeat says they are on');
select is(public.device_report_stats('dee-token', jsonb_build_array((select r from day_rows))), 1, 'one day is stored');
select is(public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"received_likes": 44}'::jsonb)), 1, 'a day sent again replaces it');
reset role;
select results_eq(
  $$ select x_handle, day, followers, likes_total, received_likes, received_views, removed_likes
     from public.daily_stats where user_id = '00000000-0000-4000-a000-0000000000d1' $$,
  $$ values ('dee_x', current_date, 120, null::integer, 44, 5200, 15) $$,
  'the row holds the counts as sent, the profile''s left out as null');

-- ── A row carries only counts in range, for recent days ──────────────────────────────────────────
set local role anon;
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"text": "hello"}'::jsonb)) $$, '22023', null,
  'a field that is not a daily number is refused, so no text can travel');
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"post_id": 1800000000000000000}'::jsonb)) $$, '22023', null,
  'nor can an id');
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"received_likes": -1}'::jsonb)) $$, '22023', null, 'a negative count is refused');
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"received_likes": 1.5}'::jsonb)) $$, '22023', null, 'so is a fraction');
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"received_views": 1000000001}'::jsonb)) $$, '22023', null,
  'so is a count over 10⁹');
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"received_likes": "40"}'::jsonb)) $$, '22023', null, 'so is a string');
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"received_likes": null}'::jsonb)) $$, '22023', null,
  'only the profile''s counts may be null');
select throws_ok($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || '{"x_handle": "not a handle!"}'::jsonb)) $$, '22023', null,
  'a malformed handle is refused');
select throws_ok(format($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || jsonb_build_object('day', %L))) $$, (current_date + 2)::text), '22023', null,
  'a day in the future is refused');
select throws_ok(format($$ select public.device_report_stats('dee-token',
  jsonb_build_array((select r from day_rows) || jsonb_build_object('day', %L))) $$, (current_date - 401)::text), '22023', null,
  'a day older than 400 days is refused');
select throws_ok($$ select public.device_report_stats('dee-token',
  (select jsonb_agg((select r from day_rows) || jsonb_build_object('day', (current_date - n)::text)) from generate_series(0, 60) n)) $$,
  '22023', null, 'more than 60 days in one call are refused');
select throws_ok($$ select public.device_report_stats('dee-token', (select r from day_rows)) $$, '22023', null,
  'a report is a list');
reset role;
select is((select count(*)::int from public.daily_stats), 1, 'a refused call stored nothing');

-- ── Each person reads only their own, and nobody writes the table directly ───────────────────────
set local role anon;
select throws_ok('select * from public.daily_stats', '42501', null, 'anon cannot read daily numbers');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000d2", "role": "authenticated"}';
select is_empty('select * from public.daily_stats', 'another person reads none of them');
select throws_ok($$ insert into public.daily_stats (user_id, x_handle, day) values
  ('00000000-0000-4000-a000-0000000000d2', 'eli_x', current_date) $$, '42501', null,
  'nobody writes the table directly, not even for themselves');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000d1", "role": "authenticated"}';
select is((select count(*)::int from public.daily_stats), 1, 'the owner reads their own');

-- ── Turning them off on the website deletes every row ────────────────────────────────────────────
select is(public.set_daily_stats(false), false, 'the owner turns them off on the website');
select is((select count(*)::int from public.daily_stats), 0, 'every row already sent is deleted');
reset role;
select is((select enabled from public.daily_stats_choices where user_id = '00000000-0000-4000-a000-0000000000d1'), false,
  'the choice is kept, so the extension stops sending');

select * from finish();
rollback;
