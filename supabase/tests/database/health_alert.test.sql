-- The email when X warns an account (#407, ADR-0047). Proves: it is off until the person turns it on; each person reads
-- only their own choice and never the stop token, nor the levels or the alerts; a job report's rise to Retreat (2) or
-- above queues one alert, Caution (1) none, a repeat of the same rise within a day none, a higher level another;
-- turning it off, or the stop link, drops what waits; the link answers the same for any token; sending needs the Vault
-- key, sends one email per person with the handles and fixed words only, at most one in six hours, drops what no longer
-- needs telling, and never comes from the website's roles. Run with `supabase test db`.
begin;
select plan(45);

-- Only this test's people: anyone else's alert on a shared local database is off for the test (rolled back after).
update public.health_alerts set enabled = false;

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-0000000000f1', 'fay@alert.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000f2', 'gus@alert.test.xomoni.com', 'authenticated', 'authenticated');
insert into public.devices (id, user_id, name, extension_version)
values
  ('00000000-0000-4000-d000-0000000000f1', '00000000-0000-4000-a000-0000000000f1', 'Fay laptop', '0.5.2'),
  ('00000000-0000-4000-d000-0000000000f2', '00000000-0000-4000-a000-0000000000f2', 'Gus laptop', '0.5.2');

-- A job report from Fay's or Gus's Xomoni, as `device_report` stores it: the account and its level when it reported.
create function pg_temp.report(owner uuid, handle text, local_id text, level smallint) returns void
language sql as $$
  insert into public.jobs (user_id, device_id, local_id, x_handle, kind, title, state, risk_level)
  values (owner, (select d.id from public.devices d where d.user_id = owner), local_id, handle, 'cleanup', 'Cleanup',
          'running', level)
  on conflict (device_id, local_id) do update set risk_level = excluded.risk_level, updated_at = now()
$$;
create function pg_temp.waiting(owner uuid) returns integer
language sql as $$
  select count(*)::integer from public.health_alert_queue q
  where q.user_id = owner and q.sent_at is null and q.dropped_at is null
$$;

-- ── Off by default ────────────────────────────────────────────────────────────────────────────────
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 0,
  'a rise to Retreat queues nothing for someone who didn''t ask');
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 0::smallint);

-- ── The choice ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000f1", "role": "authenticated"}';
select results_eq($$ select enabled, can_send from public.health_alert_status() $$,
  $$ values (false, false) $$, 'off at first, and xomoni.com can''t send while the Resend key isn''t in Vault');
select is(public.set_health_alert(true), true, 'the person turns it on');
select is((select enabled from public.health_alerts), true, 'and reads their own choice');
select throws_ok($$ select stop_token from public.health_alerts $$, '42501', null,
  'but never the stop token, which only the email carries');
select throws_ok($$ update public.health_alerts set enabled = false $$, '42501', null,
  'nor writes the table except through the function');
select throws_ok($$ select * from public.health_alert_queue $$, '42501', null, 'nor reads the alerts');
select throws_ok($$ select * from public.health_alert_levels $$, '42501', null, 'nor the levels');

set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000f2", "role": "authenticated"}';
select is((select count(*)::integer from public.health_alerts), 0, 'another person sees no one else''s row');
select results_eq($$ select enabled from public.health_alert_status() $$, $$ values (false) $$,
  'and their own status is theirs: off');

set local role anon;
select throws_ok($$ select enabled from public.health_alerts $$, '42501', null, 'anon reads nothing');
select throws_ok($$ select public.set_health_alert(true) $$, '42501', null, 'anon chooses nothing');
select throws_ok($$ select * from public.health_alert_status() $$, '42501', null, 'and asks nothing');
reset role;

-- ── A rise queues one alert ───────────────────────────────────────────────────────────────────────
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 1::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 0, 'Caution, one rate limit, queues nothing');
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 1, 'a rise to Retreat queues one alert');
select results_eq(
  $$ select x_handle, level from public.health_alert_queue where user_id = '00000000-0000-4000-a000-0000000000f1' $$,
  $$ values ('fay_x'::text, 2::smallint) $$, 'of the account and the level, nothing else');
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-2', 2::smallint);
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 1,
  'the same level in the account''s other reports queues nothing more');
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 3::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 2, 'a higher level, Defensive, queues another');
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 3::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 2,
  '3 → 2 → 3 within a day is the same rise, told once');
update public.health_alert_levels set level = 2, alerted_at = now() - interval '25 hours'
where user_id = '00000000-0000-4000-a000-0000000000f1' and x_handle = 'fay_x';
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 3::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 3, 'a day later, the same rise is told again');
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_y', 'job-3', 4::smallint);
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 4, 'another X account''s rise queues its own');

-- ── The content ───────────────────────────────────────────────────────────────────────────────────
create temporary table mail on commit drop as
  select public.health_alert_content('00000000-0000-4000-a000-0000000000f1') as c;
select is((select c ->> 'subject' from mail), 'X warned 2 of your X accounts', 'the subject counts the accounts');
select matches((select c ->> 'text' from mail),
  'X warned @fay_x again\. Xomoni stopped and won’t resume before [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d UTC at the earliest',
  'each account once, at its highest level, with when Xomoni may resume at the earliest, in UTC');
select matches((select c ->> 'text' from mail),
  'X warned @fay_y in earnest\. Xomoni stopped and won’t resume by itself: only you can, in Xomoni\.',
  'a full stop says only the person can resume');
select matches((select c ->> 'text' from mail), 'Open Xomoni to see why: https://xomoni\.com/dashboard/health',
  'its one link to act opens the dashboard''s Account health');
select matches((select c ->> 'text' from mail), 'To stop it: https://xomoni\.com/health-alert/stop\?token=[0-9a-f-]{36}',
  'and every email says how to stop it');
select ok((select c::text !~* 'resume now|approve|start|https://xomoni\.com/api/(?!health-alert)' from mail),
  'nothing in it resumes, approves or starts anything');
select is(public.health_alert_content('00000000-0000-4000-a000-0000000000f2'), null, 'no alert waiting, no email');

-- ── Sending ───────────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.send_health_alerts(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.send_health_alerts(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.health_alert_content(uuid)', 'execute'),
  'only the database itself sends or builds an alert');
select is((select count(*)::integer from cron.job where jobname = 'health-alert' and schedule = '*/5 * * * *'), 1,
  'the scheduler runs it every five minutes');

delete from net.http_request_queue;
select is(public.send_health_alerts(), 0, 'without the Resend key in Vault, nothing is sent');
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 4, 'and the alerts still wait');

select vault.create_secret('re_test_key', 'resend_api_key');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000f1", "role": "authenticated"}';
select results_eq($$ select can_send from public.health_alert_status() $$, $$ values (true) $$,
  'with the key in Vault, the website hears that xomoni.com can send');
reset role;

select is(public.send_health_alerts(), 1, 'one email to the one person who asked, whatever the number of alerts');
create temporary table sent on commit drop as
  select url, headers, convert_from(body, 'utf8')::jsonb as body from net.http_request_queue;
select ok(
  (select url = 'https://api.resend.com/emails' and headers ->> 'Authorization' = 'Bearer re_test_key'
     and body -> 'to' = '["fay@alert.test.xomoni.com"]'::jsonb
     and body ->> 'from' = 'Xomoni <no-reply@xomoni.com>'
     and body -> 'headers' ->> 'List-Unsubscribe-Post' = 'List-Unsubscribe=One-Click'
     and body -> 'headers' ->> 'List-Unsubscribe' ~ '^<https://xomoni\.com/api/health-alert/stop\?token=[0-9a-f-]{36}>$'
     and position('re_test_key' in body::text) = 0
   from sent),
  'to Resend, from no-reply@xomoni.com, with the one-click stop headers, and the key only in the header');
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 0, 'everything that waited is sent');

update public.health_alert_levels set alerted_at = now() - interval '2 days'
where user_id = '00000000-0000-4000-a000-0000000000f1';
update public.health_alert_levels set level = 1 where user_id = '00000000-0000-4000-a000-0000000000f1';
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
select is(public.send_health_alerts(now() + interval '1 hour'), 0, 'a new rise within six hours of an email waits');
select is(public.send_health_alerts(now() + interval '7 hours'), 1, 'and goes once six hours have passed');

-- What no longer needs telling is dropped.
update public.health_alert_levels set alerted_at = now() - interval '2 days', level = 0
where user_id = '00000000-0000-4000-a000-0000000000f1';
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 0::smallint);
select is(public.send_health_alerts(now() + interval '14 hours'), 0,
  'an account that rested back below Retreat before the send is not told');

-- ── Stopping ──────────────────────────────────────────────────────────────────────────────────────
update public.health_alert_levels set alerted_at = now() - interval '2 days', level = 0
where user_id = '00000000-0000-4000-a000-0000000000f1';
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000f1", "role": "authenticated"}';
select is(public.set_health_alert(false), false, 'the person turns it off');
reset role;
select is(pg_temp.waiting('00000000-0000-4000-a000-0000000000f1'), 0, 'and the alert that waited is dropped');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000f1", "role": "authenticated"}';
select public.set_health_alert(true);
reset role;
update public.health_alert_levels set alerted_at = now() - interval '2 days', level = 0
where user_id = '00000000-0000-4000-a000-0000000000f1';
select pg_temp.report('00000000-0000-4000-a000-0000000000f1', 'fay_x', 'job-1', 2::smallint);
create temporary table fay_token on commit drop as
  select stop_token as token from public.health_alerts where user_id = '00000000-0000-4000-a000-0000000000f1';
grant select on fay_token to anon;
set local role anon;
select is(public.stop_health_alert(gen_random_uuid()), true, 'an unknown token answers the same');
reset role;
select is((select enabled from public.health_alerts where user_id = '00000000-0000-4000-a000-0000000000f1'), true,
  'and stops nothing');
set local role anon;
select is(public.stop_health_alert((select token from fay_token)), true, 'the link''s token stops the alert');
reset role;
select ok(
  (select not enabled from public.health_alerts where user_id = '00000000-0000-4000-a000-0000000000f1')
    and pg_temp.waiting('00000000-0000-4000-a000-0000000000f1') = 0,
  'for that person, and what waited is dropped');

select * from finish();
rollback;
