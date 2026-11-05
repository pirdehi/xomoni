-- The release a connected browser hears about in the answer to its status report (#151). Proves the table is
-- closed to everyone, versions compare as numbers, and a security release is flagged only to older versions.
-- Run with `supabase test db`.
begin;
select plan(11);

insert into auth.users (id, email, aud, role)
values ('00000000-0000-4000-a000-00000000005a', 'ida@releases.test.xomoni.com', 'authenticated', 'authenticated');

-- ── Nobody reads or writes the table, or calls the helper ───────────────────────────────────────
set local role anon;
select throws_ok('select * from public.extension_releases', '42501', null, 'anon cannot read releases');
select throws_ok($$ select public.release_rank('1.2.3') $$, '42501', null, 'anon cannot call release_rank');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-a000-00000000005a", "role": "authenticated"}';
select throws_ok('select * from public.extension_releases', '42501', null, 'a signed-in person cannot read releases');
select throws_ok($$ insert into public.extension_releases (version) values ('9.9.9') $$, '42501', null,
  'a signed-in person cannot add a release');

-- A browser connected the usual way: a code from the website, paired by the extension.
create temporary table codes (code text, expires_at timestamptz) on commit drop;
grant all on codes to anon, authenticated;
insert into codes select * from public.create_pairing_code();
set local role anon;
create temporary table paired (device_id uuid, token text) on commit drop;
grant all on paired to anon, authenticated;
insert into paired select * from public.pair_device((select code from codes), 'Chrome', '0.1.0');

-- ── The answer names the newest release, compared as numbers ─────────────────────────────────────
reset role;
select throws_ok($$ insert into public.extension_releases (version) values ('1.0') $$, '23514', null,
  'a version must be three numbers');
insert into public.extension_releases (version, security) values ('0.2.0', false), ('0.10.0', true), ('0.9.0', false);

set local role anon;
select is(public.device_report((select token from paired), '0.1.0', '[]'),
  '{"latest": "0.10.0", "security": true}'::jsonb, 'the newest release is 0.10.0, after 0.9.0, and fixes a vulnerability');
select is(public.device_report((select token from paired), '0.9.0', '[]') ->> 'security', 'true',
  'a security release newer than the reporting version is flagged');
select is(public.device_report((select token from paired), '0.10.0', '[]'),
  '{"latest": "0.10.0", "security": false}'::jsonb, 'nothing is flagged to the newest version');
select is(public.device_report((select token from paired), '0.11.0', '[]') ->> 'security', 'false',
  'nor to a version newer than every release, such as a build of main');
select is(public.device_report((select token from paired), 'dev', '[]') ->> 'security', 'true',
  'a version that isn''t three numbers counts as older than every release');

reset role;
select is((select extension_version from public.devices where id = (select device_id from paired)), 'dev',
  'the report still records the version it came from');

select * from finish();
rollback;
