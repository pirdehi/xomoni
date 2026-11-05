-- What the Data API roles can reach (#149), checked over the whole schema so a later migration can't widen it
-- by accident: every public table has Row Level Security, anon has no table privilege at all, authenticated has
-- only what was granted by name, each role calls only its own functions, and nothing new is exposed by itself.
-- Also: a job's reason never reaches the cloud, and a device token expires after 90 days without a report.
-- Run with `supabase test db`.
begin;
select plan(14);

-- Objects that belong to an extension (pgTAP among them) are not the schema's own.
create temporary view own_tables as
  select c.oid, c.relname::text as name, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
create temporary view own_functions as
  select p.oid, p.proname::text as name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

-- ── The schema as the migrations leave it ────────────────────────────────────────────────────────
select is_empty($$ select name from own_tables where not rls $$, 'every public table has Row Level Security on');
select is_empty(
  $$ select table_name || ' ' || privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public' $$,
  'anon has no privilege on any public table');
-- Compared as one line of text: information_schema's columns and literals don't share a collation.
select is(
  (select string_agg(table_name || ' ' || privilege_type, ', ' order by table_name, privilege_type)::text
   from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public'),
  'devices DELETE, devices INSERT, devices SELECT, devices UPDATE, jobs DELETE, jobs INSERT, jobs SELECT, jobs UPDATE',
  'authenticated has exactly what was granted by name: no TRUNCATE, and nothing on the secret tables');
select is(
  (select string_agg(name, ', ' order by name) from own_functions where has_function_privilege('anon', oid, 'execute')),
  'device_report, pair_device, unpair_device',
  'anon calls only the three functions of the extension');
select is(
  (select string_agg(name, ', ' order by name) from own_functions
   where has_function_privilege('authenticated', oid, 'execute')),
  'create_pairing_code, delete_account, device_report, pair_device, unpair_device',
  'a signed-in person calls only those, plus making a code and deleting their account');

-- ── Something created from now on is exposed to nobody ────────────────────────────────────────────
create table public.exposure_probe (id integer primary key);
create sequence public.exposure_probe_seq;
create function public.exposure_probe_fn() returns integer language sql as 'select 1';
select ok(
  not has_table_privilege('anon', 'public.exposure_probe', 'select')
    and not has_table_privilege('authenticated', 'public.exposure_probe', 'select'),
  'a new table is reachable by neither anon nor authenticated');
select ok(
  not has_sequence_privilege('anon', 'public.exposure_probe_seq', 'usage')
    and not has_sequence_privilege('authenticated', 'public.exposure_probe_seq', 'usage'),
  'nor is a new sequence');
select ok(
  not has_function_privilege('anon', 'public.exposure_probe_fn()', 'execute')
    and not has_function_privilege('authenticated', 'public.exposure_probe_fn()', 'execute'),
  'nor is a new function');

-- ── A job's reason never reaches the cloud ────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role)
values ('00000000-0000-4000-a000-00000000006a', 'jo@exposure.test.xomoni.com', 'authenticated', 'authenticated');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-00000000006a", "role": "authenticated"}';
create temporary table codes (code text, expires_at timestamptz) on commit drop;
grant all on codes to anon, authenticated;
insert into codes select * from public.create_pairing_code();
set local role anon;
create temporary table paired (device_id uuid, token text) on commit drop;
grant all on paired to anon, authenticated;
insert into paired select * from public.pair_device((select code from codes), 'Chrome', '0.1.0');

select lives_ok(format($$ select public.device_report(%L, '0.1.0', %L) $$, (select token from paired),
  '[{"local_id": "job-1", "x_handle": "jo", "kind": "cleanup", "title": "Delete posts", "state": "blocked",
     "state_reason": "X says: your account is temporarily limited"}]'),
  'a report that carries a reason is taken');
reset role;
select is((select state_reason from public.jobs where local_id = 'job-1'), '', 'but the reason is not stored');
select throws_ok(
  $$ update public.jobs set state_reason = 'X says: limited' where local_id = 'job-1' $$, '23514', null,
  'and no other way can store one');

-- ── A token unused for 90 days stops working ──────────────────────────────────────────────────────
update public.device_tokens set last_used_at = now() - interval '89 days' where device_id = (select device_id from paired);
set local role anon;
select lives_ok(format($$ select public.device_report(%L, '0.1.0', '[]') $$, (select token from paired)),
  'a token last used 89 days ago still reports');
reset role;
select ok((select last_used_at > now() - interval '1 minute' from public.device_tokens
  where device_id = (select device_id from paired)), 'and the report keeps it alive');
update public.device_tokens set last_used_at = now() - interval '91 days' where device_id = (select device_id from paired);
set local role anon;
select throws_ok(format($$ select public.device_report(%L, '0.1.0', '[]') $$, (select token from paired)),
  'P0001', 'This browser is not connected to a Xomoni account.', 'a token unused for 91 days is unknown');

select * from finish();
rollback;
