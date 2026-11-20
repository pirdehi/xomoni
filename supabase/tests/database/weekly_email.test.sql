-- The weekly email of the daily numbers (#257, ADR-0031). Proves: it is off until the person turns it on, and only
-- while their numbers are on; turning the numbers off turns it off; each person reads only their own choice and never
-- the stop token; the token stops that one email and says nothing about others; the content is counts with their
-- change; and sending needs the Vault key, goes to Resend with the one-click stop headers, once a week, never from
-- the website's roles. Run with `supabase test db`.
begin;
select plan(26);

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-0000000000e1', 'dee@weekly.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000e2', 'eli@weekly.test.xomoni.com', 'authenticated', 'authenticated');
insert into public.daily_stats_choices (user_id, enabled)
values ('00000000-0000-4000-a000-0000000000e1', true), ('00000000-0000-4000-a000-0000000000e2', false);

-- ── The choice ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000e2", "role": "authenticated"}';
select throws_ok($$ select public.set_weekly_email(true) $$, 'P0001', 'Turn on your daily numbers first.',
  'without daily numbers, the email can''t be turned on');
select is(public.set_weekly_email(false), false, 'turning it off always works');

set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000e1", "role": "authenticated"}';
select is(public.set_weekly_email(true), true, 'with daily numbers on, the person turns it on');
select is((select enabled from public.weekly_emails), true, 'and reads their own choice');
select throws_ok($$ select stop_token from public.weekly_emails $$, '42501', null,
  'but never the stop token, which only the email carries');
select throws_ok($$ update public.weekly_emails set enabled = false $$, '42501', null,
  'nor writes the table except through the function');

set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-0000000000e2", "role": "authenticated"}';
select is((select count(*)::integer from public.weekly_emails), 1, 'another person sees only their own row');

set local role anon;
select throws_ok($$ select enabled from public.weekly_emails $$, '42501', null, 'anon reads nothing');
select throws_ok($$ select public.set_weekly_email(true) $$, '42501', null, 'anon chooses nothing');
reset role;

-- ── Turning the numbers off turns the email off ───────────────────────────────────────────────────
select public.choose_daily_stats('00000000-0000-4000-a000-0000000000e1', false);
select is((select enabled from public.weekly_emails where user_id = '00000000-0000-4000-a000-0000000000e1'), false,
  'turning the daily numbers off turns the email off too');
select public.choose_daily_stats('00000000-0000-4000-a000-0000000000e1', true);
update public.weekly_emails set enabled = true where user_id = '00000000-0000-4000-a000-0000000000e1';

-- ── Stopping by the link, without signing in ──────────────────────────────────────────────────────
create temporary table dee_token on commit drop as
  select stop_token as token from public.weekly_emails where user_id = '00000000-0000-4000-a000-0000000000e1';
grant select on dee_token to anon;
set local role anon;
select is(public.stop_weekly_email(gen_random_uuid()), true, 'an unknown token answers the same');
reset role;
select is((select enabled from public.weekly_emails where user_id = '00000000-0000-4000-a000-0000000000e1'), true,
  'and stops nothing');
set local role anon;
select is(public.stop_weekly_email((select token from dee_token)), true, 'the link''s token stops the email');
reset role;
select is((select enabled from public.weekly_emails where user_id = '00000000-0000-4000-a000-0000000000e1'), false,
  'for that person');
update public.weekly_emails set enabled = true where user_id = '00000000-0000-4000-a000-0000000000e1';

-- ── The content ───────────────────────────────────────────────────────────────────────────────────
-- The week ending on Sunday 2026-11-15, and the one before; two accounts.
insert into public.daily_stats (user_id, x_handle, day, followers, posted_posts, received_likes, received_views,
  removed_posts)
values
  ('00000000-0000-4000-a000-0000000000e1', 'dee_x', '2026-11-03', 100, 1, 2, 50, 0),
  ('00000000-0000-4000-a000-0000000000e1', 'dee_x', '2026-11-10', 110, 2, 5, 100, 3),
  ('00000000-0000-4000-a000-0000000000e1', 'dee_x', '2026-11-14', 120, 1, 1200, 2000, 0),
  ('00000000-0000-4000-a000-0000000000e1', 'dee_y', '2026-11-12', 7, 0, 0, 0, 0);

create temporary table mail on commit drop as
  select public.weekly_email_content('00000000-0000-4000-a000-0000000000e1', '2026-11-15') as c;
select is((select c ->> 'subject' from mail), 'Your week on X: Nov 9 to Nov 15, 2026', 'the subject names the week');
select matches((select c ->> 'text' from mail), 'Followers: 127 \(\+27 from the week before\)',
  'followers: each account''s latest, added up, with the change');
select matches((select c ->> 'text' from mail), 'Likes received \*: 1,205',
  'received counts are marked as estimates, and big numbers are readable');
select matches((select c ->> 'text' from mail), 'Removed by Xomoni: 3 \(\+3 from the week before\)',
  'what Xomoni removed');
select matches((select c ->> 'text' from mail), 'To stop it: https://xomoni\.com/weekly-email/stop\?token=[0-9a-f-]{36}',
  'every email says how to stop it');
select is(public.weekly_email_content('00000000-0000-4000-a000-0000000000e1', '2026-10-01'), null,
  'a week without numbers has no email');

-- ── Sending ───────────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.send_weekly_emails(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.send_weekly_emails(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.weekly_email_content(uuid, date)', 'execute'),
  'only the database itself sends or builds an email');
select is((select count(*)::integer from cron.job where jobname = 'weekly-email' and schedule = '0 7 * * 1'), 1,
  'the scheduler runs it on Monday mornings');

delete from net.http_request_queue;
select is(public.send_weekly_emails('2026-11-16 07:00+00'), 0, 'without the Resend key in Vault, nothing is sent');

select vault.create_secret('re_test_key', 'resend_api_key');
select is(public.send_weekly_emails('2026-11-16 07:00+00'), 1, 'with it, one email goes to the one person who asked');
create temporary table sent on commit drop as
  select url, headers, convert_from(body, 'utf8')::jsonb as body from net.http_request_queue;
select ok(
  (select url = 'https://api.resend.com/emails' and headers ->> 'Authorization' = 'Bearer re_test_key'
     and body -> 'to' = '["dee@weekly.test.xomoni.com"]'::jsonb
     and body ->> 'from' = 'Xomoni <no-reply@xomoni.com>'
     and body -> 'headers' ->> 'List-Unsubscribe-Post' = 'List-Unsubscribe=One-Click'
     and body -> 'headers' ->> 'List-Unsubscribe' ~ '^<https://xomoni\.com/api/weekly-email/stop\?token=[0-9a-f-]{36}>$'
     and position('re_test_key' in body::text) = 0
   from sent),
  'to Resend, from no-reply@xomoni.com, with the one-click stop headers, and the key only in the header');
select is(public.send_weekly_emails('2026-11-17 07:00+00'), 0, 'a second run the same week sends nothing');

select * from finish();
rollback;
