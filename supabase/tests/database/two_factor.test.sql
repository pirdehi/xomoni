-- Two-step verification (#173, ADR-0036): an account with a verified authenticator app is reachable through the Data
-- API only from a session that verified a code (`aal2`); a password or session alone (`aal1`) reads nothing and changes
-- nothing. Accounts without an app, or with one never confirmed, are unchanged. Run with `supabase test db`.
begin;
select plan(31);

-- Ada has a verified app, Bob only one he never confirmed, Cy none. Each has a device and a job.
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-0000000000f1', 'ada@two-factor.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000f2', 'bob@two-factor.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000f3', 'cy@two-factor.test.xomoni.com', 'authenticated', 'authenticated');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values
  ('00000000-0000-4000-f000-0000000000f1', '00000000-0000-4000-a000-0000000000f1', 'Phone', 'totp', 'verified',
   now(), now(), 'JBSWY3DPEHPK3PXP'),
  ('00000000-0000-4000-f000-0000000000f2', '00000000-0000-4000-a000-0000000000f2', 'Phone', 'totp', 'unverified',
   now(), now(), 'JBSWY3DPEHPK3PXP');
insert into public.devices (id, user_id, name, extension_version)
values
  ('00000000-0000-4000-d000-0000000000f1', '00000000-0000-4000-a000-0000000000f1', 'Ada laptop', '0.1.0'),
  ('00000000-0000-4000-d000-0000000000f2', '00000000-0000-4000-a000-0000000000f2', 'Bob laptop', '0.1.0'),
  ('00000000-0000-4000-d000-0000000000f3', '00000000-0000-4000-a000-0000000000f3', 'Cy laptop', '0.1.0');
insert into public.jobs (user_id, device_id, local_id, x_handle, kind, title, state)
values
  ('00000000-0000-4000-a000-0000000000f1', '00000000-0000-4000-d000-0000000000f1', 'job-f1', 'ada', 'scan', 'Ada scan',
   'running');
insert into public.daily_stats_choices (user_id, enabled) values ('00000000-0000-4000-a000-0000000000f1', true);
insert into public.weekly_emails (user_id, enabled) values ('00000000-0000-4000-a000-0000000000f1', true);

-- Claims for `who` at assurance level `aal` (null: no `aal` claim at all), signed in a minute ago.
create function pg_temp.session(who text, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', (jsonb_build_object(
    'sub', who, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 60))
  ) || case when aal is null then '{}'::jsonb else jsonb_build_object('aal', aal) end)::text, true);
end $$;
grant execute on function pg_temp.session(text, text) to authenticated;

-- ── The rule's own grants ──────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('authenticated', 'public.mfa_satisfied()', 'execute')
  and not has_function_privilege('anon', 'public.mfa_satisfied()', 'execute'),
  'a signed-in person may ask whether their session is enough; anon may not');
select ok(not has_function_privilege('authenticated', 'public.require_second_factor()', 'execute')
  and not has_function_privilege('anon', 'public.require_second_factor()', 'execute'),
  'nobody calls the guard directly');
select is(
  (select count(*)::int from pg_policies
   where policyname = 'Accounts with an authenticator app need aal2' and permissive = 'RESTRICTIVE'),
  6, 'devices, jobs, daily numbers, their choice, the weekly email and the dashboard channel each have the rule');

set local role authenticated;

-- ── Ada with only her password (aal1) ──────────────────────────────────────────────────────────────
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000f1', 'aal1'); end $$;
select is(public.mfa_satisfied(), false, 'Ada''s password alone is not enough');
select is_empty('select id from public.devices', 'Ada at aal1 reads none of her devices');
select is_empty('select id from public.jobs', 'nor her jobs');
select is_empty('select user_id from public.daily_stats_choices', 'nor her daily numbers'' choice');
select is_empty('select user_id from public.weekly_emails', 'nor her weekly email');
select throws_ok(
  $$ insert into public.devices (name, extension_version) values ('forged', '0.1.0') $$,
  '42501', null, 'Ada at aal1 can''t add a device');
select is_empty($$ update public.devices set name = 'renamed' returning id $$, 'nor rename one');
select is_empty($$ delete from public.jobs returning id $$, 'nor delete a job');
select throws_ok('select * from public.create_pairing_code()', 'P0001',
  'Enter a code from your authenticator app first.', 'nor make a pairing code');
select throws_ok('select public.set_daily_stats(false)', 'P0001', null, 'nor turn her daily numbers off');
select throws_ok('select public.set_weekly_email(false)', 'P0001', null, 'nor stop her weekly email');
select throws_ok('select public.delete_account()', 'P0001', 'Enter a code from your authenticator app first.',
  'nor delete her account, though she signed in a minute ago');

do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000f1', null); end $$;
select is(public.mfa_satisfied(), false, 'a token without an aal claim counts as aal1');
select is_empty('select id from public.devices', 'and reads nothing');

-- ── Ada after a code from her app (aal2) ───────────────────────────────────────────────────────────
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000f1', 'aal2'); end $$;
select is(public.mfa_satisfied(), true, 'Ada after a code is enough');
select results_eq('select name from public.devices', array['Ada laptop'], 'Ada at aal2 reads her device, and only hers');
select results_eq('select title from public.jobs', array['Ada scan'], 'and her job');
select isnt_empty('select user_id from public.weekly_emails', 'and her weekly email');
select lives_ok('select * from public.create_pairing_code()', 'and makes a pairing code');
select lives_ok('select public.set_daily_stats(true)', 'and chooses her daily numbers');
select is_empty(
  $$ update public.devices set name = 'renamed' where user_id = '00000000-0000-4000-a000-0000000000f3' returning id $$,
  'aal2 widens nothing: Ada still can''t rename Cy''s device');

-- ── Bob, who never confirmed his app, and Cy, who has none ─────────────────────────────────────────
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000f2', 'aal1'); end $$;
select is(public.mfa_satisfied(), true, 'an app never confirmed asks for nothing');
select results_eq('select name from public.devices', array['Bob laptop'], 'Bob at aal1 reads his device');

do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000f3', 'aal1'); end $$;
select is(public.mfa_satisfied(), true, 'an account without an app is unchanged');
select results_eq('select name from public.devices', array['Cy laptop'], 'Cy at aal1 reads his device');
select lives_ok('select * from public.create_pairing_code()', 'and makes a pairing code');

-- ── Deleting the account ───────────────────────────────────────────────────────────────────────────
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000f1', 'aal2'); end $$;
select lives_ok('select public.delete_account()', 'Ada at aal2, signed in a minute ago, may delete her account');
reset role;
select is((select count(*)::int from auth.users where email like '%@two-factor.test.xomoni.com'), 2,
  'only Ada''s account is gone');

select * from finish();
rollback;
