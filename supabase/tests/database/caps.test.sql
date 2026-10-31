-- Caps on what one account stores (#82): 10 devices per account, the newest 1,000 jobs per device.
-- Run with `supabase test db`.
begin;
select plan(9);

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-00000000003a', 'dee@caps.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000003b', 'eve@caps.test.xomoni.com', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-00000000003a", "role": "authenticated"}';

-- Devices: refused past 10, in one statement or one at a time.
select throws_ok(
  $$ insert into public.devices (name, extension_version) select 'bulk ' || n, '0.2.0' from generate_series(1, 11) n $$,
  'P0001', 'An account can connect at most 10 browsers. Disconnect one on the dashboard first.',
  'eleven devices in one request are refused'
);
select lives_ok(
  $$ insert into public.devices (name, extension_version) select 'browser ' || n, '0.2.0' from generate_series(1, 10) n $$,
  'ten devices are fine'
);
select throws_ok(
  $$ insert into public.devices (name, extension_version) values ('one more', '0.2.0') $$,
  'P0001', null, 'an eleventh device is refused'
);
select is((select count(*)::int from public.devices), 10, 'Dee still has her ten devices');

-- The cap counts per account: Eve can still connect hers.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-00000000003b", "role": "authenticated"}';
select lives_ok(
  $$ insert into public.devices (id, name, extension_version)
     values ('00000000-0000-4000-d000-00000000003b', 'Eve laptop', '0.2.0') $$,
  'another account is not affected'
);

-- Jobs: the oldest beyond 1,000 per device go; nothing is refused.
select lives_ok(
  $$ insert into public.jobs (device_id, local_id, x_handle, kind, title, state, updated_at)
     select '00000000-0000-4000-d000-00000000003b', 'job-' || n, 'eve', 'scan', 'Scan ' || n, 'completed',
            now() - make_interval(mins => 2000 - n)
     from generate_series(1, 1000) n $$,
  'a thousand jobs fit'
);
select lives_ok(
  $$ insert into public.jobs (device_id, local_id, x_handle, kind, title, state)
     select '00000000-0000-4000-d000-00000000003b', 'new-' || n, 'eve', 'scan', 'New ' || n, 'running'
     from generate_series(1, 5) n $$,
  'five more are accepted'
);
select is((select count(*)::int from public.jobs), 1000, 'the device keeps 1,000 jobs');
select results_eq(
  $$ select local_id from public.jobs where local_id in ('job-1', 'job-5', 'job-6', 'new-5') order by local_id $$,
  array['job-6', 'new-5'],
  'the five oldest went; the newest stayed'
);

select * from finish();
rollback;
