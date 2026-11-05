-- Live dashboard updates go only to their owner's private topic (#149, #81): every insert, update and delete of
-- a device or a job is broadcast on `dashboard:<owner>`, privately, and the tables are no longer published, so
-- no one else hears of them, deletions included. Run with `supabase test db`.
begin;
select plan(8);

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-00000000007a', 'kim@broadcast.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000007b', 'lou@broadcast.test.xomoni.com', 'authenticated', 'authenticated');

select is_empty(
  $$ select tablename from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('devices', 'jobs') $$,
  'devices and jobs are no longer published to Postgres-changes subscribers');
select ok(not has_function_privilege('anon', 'public.dashboard_broadcast()', 'execute')
  and not has_function_privilege('authenticated', 'public.dashboard_broadcast()', 'execute'),
  'nobody calls the trigger function directly');

-- What was broadcast in this transaction, oldest first.
create temporary view sent as
  select topic, event, private, payload ->> 'table' as tbl, payload -> 'record' ->> 'title' as title
  from realtime.messages where extension = 'broadcast' and topic like 'dashboard:%';

insert into public.devices (id, user_id, name, extension_version)
values ('00000000-0000-4000-d000-00000000007a', '00000000-0000-4000-a000-00000000007a', 'Kim laptop', '0.1.0');
insert into public.jobs (user_id, device_id, local_id, x_handle, kind, title, state)
values ('00000000-0000-4000-a000-00000000007a', '00000000-0000-4000-d000-00000000007a', 'job-k', 'kim', 'scan',
        'Kim scan', 'running');
update public.jobs set state = 'completed' where local_id = 'job-k';

select results_eq(
  $$ select tbl, event from sent order by tbl, event $$,
  $$ values ('devices', 'INSERT'), ('jobs', 'INSERT'), ('jobs', 'UPDATE') $$,
  'each change of Kim''s device and job is broadcast');
select is_empty($$ select topic from sent where topic <> 'dashboard:00000000-0000-4000-a000-00000000007a' $$,
  'only on Kim''s own topic');
select is_empty($$ select topic from sent where not private $$, 'and only privately');
select is((select title from sent where event = 'UPDATE'), 'Kim scan', 'the row comes with it');

delete from public.devices where id = '00000000-0000-4000-d000-00000000007a';
select results_eq(
  $$ select tbl from sent where event = 'DELETE' order by tbl $$,
  $$ values ('devices'), ('jobs') $$,
  'deleting the device, and its job with it, is broadcast too');
select is_empty($$ select topic from sent where topic <> 'dashboard:00000000-0000-4000-a000-00000000007a' $$,
  'and still only to Kim');

select * from finish();
rollback;
