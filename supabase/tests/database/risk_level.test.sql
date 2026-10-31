-- jobs.risk_level (#41): a level from 0 to 4 or null, and the row policies cover it like every other column.
-- Run with `supabase test db`.
begin;
select plan(9);

select has_column('public', 'jobs', 'risk_level', 'jobs has a risk_level column');
select col_type_is('public', 'jobs', 'risk_level', 'smallint', 'risk_level is a small integer');
select col_is_null('public', 'jobs', 'risk_level', 'risk_level may be null (not reported yet)');
select col_hasnt_default('public', 'jobs', 'risk_level', 'risk_level has no default: no level until the extension reports one');

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-00000000001a', 'ada@risk.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000001b', 'bob@risk.test.xomoni.com', 'authenticated', 'authenticated');
insert into public.devices (id, user_id, name, extension_version)
values
  ('00000000-0000-4000-d000-00000000001a', '00000000-0000-4000-a000-00000000001a', 'Ada laptop', '0.1.0'),
  ('00000000-0000-4000-d000-00000000001b', '00000000-0000-4000-a000-00000000001b', 'Bob laptop', '0.1.0');
insert into public.jobs (user_id, device_id, local_id, x_handle, kind, title, state, risk_level)
values
  ('00000000-0000-4000-a000-00000000001b', '00000000-0000-4000-d000-00000000001b', 'job-b', 'bob', 'cleanup', 'Bob cleanup', 'running', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-00000000001a", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.jobs (device_id, local_id, x_handle, kind, title, state, risk_level)
     values ('00000000-0000-4000-d000-00000000001a', 'job-a', 'ada', 'cleanup', 'Ada cleanup', 'running', 2) $$,
  'Ada reports a job with its account''s risk level'
);
select throws_ok(
  $$ update public.jobs set risk_level = 5 where local_id = 'job-a' $$,
  '23514', null, 'a level above 4 is rejected'
);
select throws_ok(
  $$ update public.jobs set risk_level = -1 where local_id = 'job-a' $$,
  '23514', null, 'a negative level is rejected'
);
select is_empty(
  $$ update public.jobs set risk_level = 4 where local_id = 'job-b' returning id $$,
  'Ada cannot change the level on Bob''s job'
);

reset role;
select results_eq(
  $$ select x_handle || '=' || risk_level from public.jobs where local_id in ('job-a', 'job-b') order by x_handle $$,
  array['ada=2', 'bob=0'],
  'each level is as its owner reported it'
);

select * from finish();
rollback;
