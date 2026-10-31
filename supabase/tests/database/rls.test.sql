-- Row Level Security on devices and jobs, and delete_account().
-- Proves the negative cases: anon sees nothing; a user can't read, change or attach to another
-- user's rows; delete_account() removes only the caller. Run with `supabase test db`.
begin;
select plan(17);

-- Two users, each with one device and one job (inserted as the table owner, bypassing RLS).
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-00000000000a', 'ada@test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'bob@test.xomoni.com', 'authenticated', 'authenticated');

insert into public.devices (id, user_id, name, extension_version)
values
  ('00000000-0000-4000-d000-00000000000a', '00000000-0000-4000-a000-00000000000a', 'Ada laptop', '0.1.0'),
  ('00000000-0000-4000-d000-00000000000b', '00000000-0000-4000-a000-00000000000b', 'Bob laptop', '0.1.0');

insert into public.jobs (user_id, device_id, local_id, x_handle, kind, title, state)
values
  ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-d000-00000000000a', 'job-a', 'ada', 'scan', 'Ada scan', 'running'),
  ('00000000-0000-4000-a000-00000000000b', '00000000-0000-4000-d000-00000000000b', 'job-b', 'bob', 'scan', 'Bob scan', 'running');

-- ── Anonymous visitors ───────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.devices', '42501', null, 'anon cannot read devices');
select throws_ok('select * from public.jobs', '42501', null, 'anon cannot read jobs');
select throws_ok('select public.delete_account()', '42501', null, 'anon cannot call delete_account');

-- ── Signed in as Ada ─────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-00000000000a", "role": "authenticated"}';

select results_eq('select name from public.devices', array['Ada laptop'], 'Ada sees only her device');
select results_eq('select title from public.jobs', array['Ada scan'], 'Ada sees only her job');

select throws_ok(
  $$ insert into public.devices (user_id, name, extension_version)
     values ('00000000-0000-4000-a000-00000000000b', 'forged', '0.1.0') $$,
  '42501', null, 'Ada cannot create a device for Bob'
);
select throws_ok(
  $$ insert into public.jobs (device_id, local_id, x_handle, kind, title, state)
     values ('00000000-0000-4000-d000-00000000000b', 'job-x', 'ada', 'scan', 'on Bob device', 'queued') $$,
  '42501', null, 'Ada cannot report a job on Bob''s device'
);
select lives_ok(
  $$ insert into public.devices (name, extension_version) values ('Ada desktop', '0.1.0') $$,
  'Ada can add her own device (user_id defaults to her)'
);
select is_empty(
  $$ update public.devices set name = 'renamed' where user_id = '00000000-0000-4000-a000-00000000000b' returning id $$,
  'Ada cannot rename Bob''s device'
);
select is_empty(
  $$ update public.jobs set state = 'cancelled' where user_id = '00000000-0000-4000-a000-00000000000b' returning id $$,
  'Ada cannot change Bob''s job'
);
select throws_ok(
  $$ update public.jobs set user_id = '00000000-0000-4000-a000-00000000000b' where local_id = 'job-a' $$,
  '42501', null, 'Ada cannot hand her job to Bob'
);
select is_empty(
  $$ delete from public.devices where user_id = '00000000-0000-4000-a000-00000000000b' returning id $$,
  'Ada cannot delete Bob''s device'
);

select lives_ok('select public.delete_account()', 'Ada can delete her own account');

-- ── Back to the owner role to check the effects ──────────────────────────────────────────────
reset role;
select is(
  (select count(*)::int from auth.users where email like '%@test.xomoni.com'), 1,
  'delete_account removed exactly one user'
);
select is(
  (select email::text from auth.users where email like '%@test.xomoni.com'), 'bob@test.xomoni.com',
  'the remaining user is Bob'
);
select is(
  (select count(*)::int from public.devices where user_id = '00000000-0000-4000-a000-00000000000a'), 0,
  'Ada''s devices were removed with her account'
);
select results_eq(
  $$ select d.name || '/' || j.state from public.devices d join public.jobs j on j.device_id = d.id
     where d.user_id = '00000000-0000-4000-a000-00000000000b' $$,
  array['Bob laptop/running'],
  'Bob''s device and job are untouched'
);

select * from finish();
rollback;
