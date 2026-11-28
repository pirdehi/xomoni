-- Private product documents (ADR-0048): only a super-admin reads them or adds a version; nobody, not even a
-- super-admin, changes or deletes one through the Data API; nobody but the admin role reads or changes who is a
-- super-admin; an account with an authenticator app needs aal2; the database refuses oversize or malformed rows.
-- Run with `supabase test db`.
begin;
select plan(24);

-- Ada is a super-admin, Ben is an ordinary account, Cy is a super-admin with an authenticator app.
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-0000000000d1', 'ada@docs.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000d2', 'ben@docs.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000d3', 'cy@docs.test.xomoni.com', 'authenticated', 'authenticated');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('00000000-0000-4000-f000-0000000000d3', '00000000-0000-4000-a000-0000000000d3', 'Phone', 'totp', 'verified',
  now(), now(), 'JBSWY3DPEHPK3PXP');
insert into public.app_admins (user_id, role)
values
  ('00000000-0000-4000-a000-0000000000d1', 'superadmin'),
  ('00000000-0000-4000-a000-0000000000d3', 'superadmin');
insert into public.product_documents (slug, title, html, created_by)
values ('product', 'Version one', '<html><body>one</body></html>', '00000000-0000-4000-a000-0000000000d1');

-- Claims for `who` at assurance level `aal`, signed in a minute ago.
create function pg_temp.session(who text, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', who, 'role', 'authenticated', 'aal', aal,
    'amr', jsonb_build_array(jsonb_build_object('method', 'oauth', 'timestamp', extract(epoch from now())::bigint - 60))
  )::text, true);
end $$;
grant execute on function pg_temp.session(text, text) to authenticated;

-- ── The schema ──────────────────────────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.app_admins'::regclass), 'app_admins has RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.product_documents'::regclass),
  'product_documents has RLS on');
select ok(not has_table_privilege('authenticated', 'public.app_admins', 'select'),
  'a signed-in person can''t read who is a super-admin');
select ok(not has_table_privilege('authenticated', 'public.product_documents', 'update')
    and not has_table_privilege('authenticated', 'public.product_documents', 'delete'),
  'nobody changes or deletes a version through the Data API');
select ok(not has_table_privilege('anon', 'public.product_documents', 'select'), 'anon can''t read documents');
select ok(not has_function_privilege('anon', 'public.is_superadmin()', 'execute'), 'anon can''t ask who is a super-admin');

-- ── An ordinary account ─────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.session('00000000-0000-4000-a000-0000000000d2', 'aal1');
select is(public.is_superadmin(), false, 'Ben is not a super-admin');
select is((select count(*)::int from public.product_documents), 0, 'and reads no document');
select throws_ok(
  $$ insert into public.product_documents (slug, title, html) values ('product', 'Mine', '<html>x</html>') $$,
  '42501', null, 'nor adds a version');

-- ── A super-admin ───────────────────────────────────────────────────────────────────────────────
select pg_temp.session('00000000-0000-4000-a000-0000000000d1', 'aal1');
select is(public.is_superadmin(), true, 'Ada is a super-admin');
select is((select title from public.product_documents where slug = 'product'), 'Version one', 'and reads the document');
select lives_ok(
  $$ insert into public.product_documents (slug, title, html) values ('product', 'Version two', '<html>two</html>') $$,
  'she adds a version');
select is((select created_by from public.product_documents where title = 'Version two'),
  '00000000-0000-4000-a000-0000000000d1'::uuid, 'which is recorded as hers');
select throws_ok(
  $$ insert into public.product_documents (slug, title, html, created_by)
     values ('product', 'Forged', '<html>x</html>', '00000000-0000-4000-a000-0000000000d2') $$,
  '42501', null, 'she can''t add one in someone else''s name');
select throws_ok($$ update public.product_documents set title = 'Changed' $$, '42501', null,
  'she can''t change a version');
select throws_ok($$ delete from public.product_documents $$, '42501', null, 'nor delete one');
select throws_ok($$ insert into public.app_admins (user_id, role) values ('00000000-0000-4000-a000-0000000000d2', 'superadmin') $$,
  '42501', null, 'nor make someone else a super-admin');

-- ── The database refuses what doesn't fit ─────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.product_documents (slug, title, html) values ('Product!', 'x', '<html>x</html>') $$,
  '23514', null, 'a slug other than lowercase letters, digits and dashes');
select throws_ok(
  $$ insert into public.product_documents (slug, title, html) values ('product', '', '<html>x</html>') $$,
  '23514', null, 'an empty title');
select throws_ok(
  format($$ insert into public.product_documents (slug, title, html) values ('product', 'Big', %L) $$,
    repeat('x', 1000001)),
  '23514', null, 'a page over 1,000,000 bytes');

-- ── A super-admin with an authenticator app ───────────────────────────────────────────────────────
select pg_temp.session('00000000-0000-4000-a000-0000000000d3', 'aal1');
select is((select count(*)::int from public.product_documents), 0, 'Cy reads nothing before verifying a code');
select throws_ok(
  $$ insert into public.product_documents (slug, title, html) values ('product', 'Cy', '<html>cy</html>') $$,
  '42501', null, 'nor adds a version');
select pg_temp.session('00000000-0000-4000-a000-0000000000d3', 'aal2');
select is((select count(*)::int from public.product_documents), 2, 'after the code, Cy reads both versions');

-- ── Deleting a super-admin's account ──────────────────────────────────────────────────────────────
reset role;
delete from auth.users where id = '00000000-0000-4000-a000-0000000000d1';
select is((select count(*)::int from public.product_documents where created_by is null), 2,
  'keeps the versions she added, without her id, and ends her super-admin row');

select * from finish();
rollback;
