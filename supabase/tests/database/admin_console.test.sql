-- The super-admin console (#516): only a super-admin, at aal2 when the account has an authenticator app, reads the
-- overview, the accounts and the log, and bans, signs out or deletes an account; never their own nor another
-- super-admin's. Each act is logged, and the log outlives the accounts. Nobody writes the log or the product plan
-- through the Data API, and only super-admins read them. Run with `supabase test db`.
--
-- One snapshot for the whole test: the overview's numbers are compared before and after the seed, and the local stack
-- may hold other accounts, or be used by other tests at the same time.
begin isolation level repeatable read;
select plan(130);

-- Ada and Cy are super-admins; Cy has an authenticator app. The others are ordinary accounts, added after the first
-- overview below.
insert into auth.users (id, email, aud, role, created_at, email_confirmed_at, last_sign_in_at)
values
  ('00000000-0000-4000-a000-0000000000c1', 'ada@console.test.xomoni.com', 'authenticated', 'authenticated',
   now() - interval '60 days', now() - interval '60 days', now() - interval '1 hour'),
  ('00000000-0000-4000-a000-0000000000c3', 'cy@console.test.xomoni.com', 'authenticated', 'authenticated',
   now() - interval '25 days', now() - interval '25 days', null);
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('00000000-0000-4000-f000-0000000000c3', '00000000-0000-4000-a000-0000000000c3', 'Phone', 'totp', 'verified',
  now(), now(), 'JBSWY3DPEHPK3PXP');
insert into public.app_admins (user_id, role)
values
  ('00000000-0000-4000-a000-0000000000c1', 'superadmin'),
  ('00000000-0000-4000-a000-0000000000c3', 'superadmin');

-- Claims for `who` at assurance level `aal`, signed in a minute ago.
create function pg_temp.session(who text, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', who, 'role', 'authenticated', 'aal', aal,
    'amr', jsonb_build_array(jsonb_build_object('method', 'oauth', 'timestamp', extract(epoch from now())::bigint - 60))
  )::text, true);
end $$;
grant execute on function pg_temp.session(text, text) to authenticated;

-- The overview before and after the seed, and what one number in it rose by.
create temporary table snapshots (name text primary key, body jsonb) on commit drop;
grant all on snapshots to authenticated;
create function pg_temp.rise(path text[]) returns integer language sql as $$
  select (select (s.body #>> path)::integer from snapshots s where s.name = 'after')
    - (select (s.body #>> path)::integer from snapshots s where s.name = 'before')
$$;
create function pg_temp.version_rise(version text) returns integer language sql as $$
  select coalesce((select (v ->> 'devices')::integer
                   from snapshots s, jsonb_array_elements(s.body -> 'devices' -> 'versions') v
                   where s.name = 'after' and v ->> 'version' = version), 0)
    - coalesce((select (v ->> 'devices')::integer
                from snapshots s, jsonb_array_elements(s.body -> 'devices' -> 'versions') v
                where s.name = 'before' and v ->> 'version' = version), 0)
$$;
-- The emails of a page of admin_users(), in its order, without the shared domain.
create function pg_temp.names(page jsonb) returns text[] language sql as $$
  select coalesce(array_agg(split_part(r ->> 'email', '@', 1) order by i), '{}')
  from jsonb_array_elements(page -> 'rows') with ordinality as x (r, i)
$$;
-- The full emails of a page, in its order.
create function pg_temp.emails(page jsonb) returns text[] language sql as $$
  select coalesce(array_agg(r ->> 'email' order by i), '{}')
  from jsonb_array_elements(page -> 'rows') with ordinality as x (r, i)
$$;
grant execute on function pg_temp.rise(text[]), pg_temp.version_rise(text), pg_temp.names(jsonb), pg_temp.emails(jsonb)
  to authenticated;
-- How many accounts there are, read as the admin role: a signed-in person can't read auth.users.
create temporary view accounts as
  select count(*)::integer as total, (count(*) filter (where strpos(email, '%') > 0))::integer as with_percent
  from auth.users;
grant select on accounts to authenticated;

-- ── The schema ──────────────────────────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.admin_audit'::regclass), 'admin_audit has RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.product_plan'::regclass), 'product_plan has RLS on');
select ok(has_table_privilege('authenticated', 'public.admin_audit', 'select')
    and not has_table_privilege('authenticated', 'public.admin_audit', 'insert')
    and not has_table_privilege('authenticated', 'public.admin_audit', 'update')
    and not has_table_privilege('authenticated', 'public.admin_audit', 'delete')
    and not has_table_privilege('authenticated', 'public.admin_audit', 'truncate'),
  'a signed-in person may only read the log, which Row Level Security keeps to super-admins');
select ok(has_table_privilege('authenticated', 'public.product_plan', 'select')
    and not has_table_privilege('authenticated', 'public.product_plan', 'insert')
    and not has_table_privilege('authenticated', 'public.product_plan', 'update')
    and not has_table_privilege('authenticated', 'public.product_plan', 'delete')
    and not has_table_privilege('authenticated', 'public.product_plan', 'truncate'),
  'and may only read the product plan');
select ok(not has_table_privilege('anon', 'public.admin_audit', 'select')
    and not has_table_privilege('anon', 'public.product_plan', 'select'),
  'anon reads neither');
select is(
  (select string_agg(p.proname::text, ', ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%'
     and p.prosecdef and p.proconfig = array['search_path=""']
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')),
  'admin_audit_log, admin_delete_user, admin_overview, admin_set_banned, admin_sign_out_user, admin_user, admin_users',
  'the seven console functions run as their owner with an empty search path, for signed-in people only');

-- ── The overview, before the seed ─────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.session('00000000-0000-4000-a000-0000000000c1', 'aal1');
insert into snapshots select 'before', public.admin_overview();
reset role;

-- Ben: email and two Google identities, a Plus plan, two browsers, three jobs, two sessions, every email choice on.
-- Dee: unconfirmed, a revoked Pro plan, daily numbers on. Eve: today, an authenticator app, banned for a day, Pro,
-- one browser, one queued job, one session. Fay: 35 days old, one browser, a job cancelled 10 days ago, one session.
-- Dee1 and E-ve are decoys for the search, and E-ve has an app she never confirmed, a lapsed ban and a lapsed Plus.
insert into auth.users (id, email, aud, role, created_at, email_confirmed_at, last_sign_in_at, banned_until)
values
  ('00000000-0000-4000-a000-0000000000c2', 'ben@console.test.xomoni.com', 'authenticated', 'authenticated',
   now() - interval '3 days', now() - interval '3 days', now() - interval '2 days', null),
  ('00000000-0000-4000-a000-0000000000c4', 'dee%50@console.test.xomoni.com', 'authenticated', 'authenticated',
   now() - interval '10 days', null, null, null),
  ('00000000-0000-4000-a000-0000000000c5', 'e_ve@console.test.xomoni.com', 'authenticated', 'authenticated',
   now(), now(), now(), now() + interval '1 day'),
  ('00000000-0000-4000-a000-0000000000c6', 'fay@console.test.xomoni.com', 'authenticated', 'authenticated',
   now() - interval '35 days', now() - interval '35 days', now() - interval '5 days', null),
  ('00000000-0000-4000-a000-0000000000c7', 'dee150@console.test.xomoni.com', 'authenticated', 'authenticated',
   now() - interval '40 days', now() - interval '40 days', now() - interval '40 days', null),
  ('00000000-0000-4000-a000-0000000000c8', 'e-ve@console.test.xomoni.com', 'authenticated', 'authenticated',
   now() - interval '20 days', now() - interval '20 days', now() - interval '19 days', now() - interval '1 day');
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values
  ('00000000-0000-4000-a000-0000000000c2', '00000000-0000-4000-a000-0000000000c2', '{}', 'email', now(), now()),
  ('google-ben-1', '00000000-0000-4000-a000-0000000000c2', '{}', 'google', now(), now()),
  ('google-ben-2', '00000000-0000-4000-a000-0000000000c2', '{}', 'google', now(), now());
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values
  ('00000000-0000-4000-f000-0000000000c5', '00000000-0000-4000-a000-0000000000c5', 'Phone', 'totp', 'verified',
   now(), now(), 'JBSWY3DPEHPK3PXP'),
  ('00000000-0000-4000-f000-0000000000c8', '00000000-0000-4000-a000-0000000000c8', 'Phone', 'totp', 'unverified',
   now(), now(), 'JBSWY3DPEHPK3PXP');
insert into public.entitlements (user_id, tier, status, source, valid_until, event_at)
values
  ('00000000-0000-4000-a000-0000000000c2', 'plus', 'active', 'subscription', now() + interval '30 days', now()),
  ('00000000-0000-4000-a000-0000000000c4', 'pro', 'revoked', 'subscription', now() + interval '30 days', now()),
  ('00000000-0000-4000-a000-0000000000c5', 'pro', 'active', 'subscription', now() + interval '30 days', now()),
  ('00000000-0000-4000-a000-0000000000c8', 'plus', 'canceled', 'subscription', now() - interval '1 day', now());
insert into public.devices (id, user_id, name, extension_version, created_at, last_seen_at)
values
  ('00000000-0000-4000-d000-0000000001c2', '00000000-0000-4000-a000-0000000000c2', 'Ben laptop', '0.6.0',
   now() - interval '3 days', now() - interval '1 day'),
  ('00000000-0000-4000-d000-0000000002c2', '00000000-0000-4000-a000-0000000000c2', 'Ben desktop', '0.5.3',
   now() - interval '3 days', now() - interval '20 days'),
  ('00000000-0000-4000-d000-0000000000c5', '00000000-0000-4000-a000-0000000000c5', 'Eve laptop', '0.6.0', now(), now()),
  ('00000000-0000-4000-d000-0000000000c6', '00000000-0000-4000-a000-0000000000c6', 'Fay laptop', '0.5.3',
   now() - interval '30 days', now() - interval '3 days');
insert into public.jobs (user_id, device_id, local_id, x_handle, kind, title, state, matched, done, failed, updated_at)
values
  ('00000000-0000-4000-a000-0000000000c2', '00000000-0000-4000-d000-0000000001c2', 'job-1', 'ben', 'cleanup',
   'Delete old posts', 'running', 10, 4, 1, now() - interval '1 hour'),
  ('00000000-0000-4000-a000-0000000000c2', '00000000-0000-4000-d000-0000000001c2', 'job-2', 'ben', 'scan',
   'Scan likes', 'paused', 0, 0, 0, now() - interval '2 hours'),
  ('00000000-0000-4000-a000-0000000000c2', '00000000-0000-4000-d000-0000000002c2', 'job-3', 'ben', 'cleanup',
   'Delete replies', 'failed', 5, 2, 3, now() - interval '2 days'),
  ('00000000-0000-4000-a000-0000000000c5', '00000000-0000-4000-d000-0000000000c5', 'job-4', 'eve', 'scan',
   'Scan posts', 'queued', 0, 0, 0, now()),
  ('00000000-0000-4000-a000-0000000000c6', '00000000-0000-4000-d000-0000000000c6', 'job-5', 'fay', 'cleanup',
   'Delete likes', 'cancelled', 0, 0, 0, now() - interval '10 days');
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  ('00000000-0000-4000-e000-0000000001c2', '00000000-0000-4000-a000-0000000000c2', now(), now(), 'aal1'),
  ('00000000-0000-4000-e000-0000000002c2', '00000000-0000-4000-a000-0000000000c2', now(), now(), 'aal1'),
  ('00000000-0000-4000-e000-0000000000c5', '00000000-0000-4000-a000-0000000000c5', now(), now(), 'aal2'),
  ('00000000-0000-4000-e000-0000000000c6', '00000000-0000-4000-a000-0000000000c6', now(), now(), 'aal1');
-- One token with Ben's session, one from before sessions existed.
insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
values
  ('console-test-token-1', '00000000-0000-4000-a000-0000000000c2', '00000000-0000-4000-e000-0000000001c2', false,
   now(), now()),
  ('console-test-token-2', '00000000-0000-4000-a000-0000000000c2', null, false, now(), now());
insert into public.daily_stats_choices (user_id, enabled)
values ('00000000-0000-4000-a000-0000000000c2', true), ('00000000-0000-4000-a000-0000000000c4', true);
insert into public.weekly_emails (user_id, enabled)
values ('00000000-0000-4000-a000-0000000000c2', true), ('00000000-0000-4000-a000-0000000000c4', false);
insert into public.health_alerts (user_id, enabled)
values ('00000000-0000-4000-a000-0000000000c2', true), ('00000000-0000-4000-a000-0000000000c5', true);

-- ── The overview, after the seed ──────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.session('00000000-0000-4000-a000-0000000000c1', 'aal1');
insert into snapshots select 'after', public.admin_overview();

select is((select array_agg(k order by k) from snapshots s, jsonb_object_keys(s.body) k where s.name = 'after'),
  array['devices', 'emails', 'jobs', 'plans', 'signups', 'users'], 'the overview has its six parts');
select is(
  (select jsonb_object_agg(k, pg_temp.rise(array['users', k])) from snapshots s, jsonb_object_keys(s.body -> 'users') k
   where s.name = 'after'),
  '{"total": 6, "confirmed": 5, "new_7d": 2, "new_30d": 4, "signed_in_30d": 4, "with_mfa": 1, "banned": 1}'::jsonb,
  'the accounts: six more, five confirmed, two from the last 7 days and four from 30, four signed in within 30 days, '
    || 'one with a confirmed app, one banned now');
select is(
  (select count(*)::integer from snapshots s, jsonb_each(s.body -> 'users') e
   where s.name = 'after' and jsonb_typeof(e.value) <> 'number'),
  0, 'every account count is a number');
select is(
  jsonb_build_object('total', pg_temp.rise('{devices,total}'), 'active_7d', pg_temp.rise('{devices,active_7d}'),
    '0.6.0', pg_temp.version_rise('0.6.0'), '0.5.3', pg_temp.version_rise('0.5.3')),
  '{"total": 4, "active_7d": 3, "0.6.0": 2, "0.5.3": 2}'::jsonb,
  'the browsers: four more, three seen within 7 days, two on each version');
select ok(
  (select bool_and(v ?& array['version', 'devices'] and (select count(*) from jsonb_object_keys(v)) = 2
     and (i = 1 or (v ->> 'devices')::integer
       <= ((s.body -> 'devices' -> 'versions' -> (i::integer - 2)) ->> 'devices')::integer))
   from snapshots s, jsonb_array_elements(s.body -> 'devices' -> 'versions') with ordinality as x (v, i)
   where s.name = 'after'),
  'each version is {version, devices}, the most used first');
select is(
  (select jsonb_object_agg(k, pg_temp.rise(array['jobs', k])) from snapshots s, jsonb_object_keys(s.body -> 'jobs') k
   where s.name = 'after'),
  '{"total": 5, "running": 1, "waiting": 2, "finished_7d": 1}'::jsonb,
  'the jobs: five more, one running, a paused and a queued one waiting, one failed within 7 days (not the one '
    || 'cancelled 10 days ago)');
select is(
  (select jsonb_agg(jsonb_build_object('tier', a.e ->> 'tier',
       'accounts', (a.e ->> 'accounts')::integer - (b.e ->> 'accounts')::integer) order by a.i)
   from snapshots sa, jsonb_array_elements(sa.body -> 'plans') with ordinality as a (e, i),
        snapshots sb, jsonb_array_elements(sb.body -> 'plans') with ordinality as b (e, i)
   where sa.name = 'after' and sb.name = 'before' and a.i = b.i),
  '[{"tier": "free", "accounts": 4}, {"tier": "plus", "accounts": 1}, {"tier": "pro", "accounts": 1}]'::jsonb,
  'the plans as they count now, free, plus, pro: a revoked, a lapsed and no plan are free');
select is(
  (select sum((p ->> 'accounts')::integer)::integer from snapshots s, jsonb_array_elements(s.body -> 'plans') p
   where s.name = 'after'),
  (select (s.body #>> '{users,total}')::integer from snapshots s where s.name = 'after'),
  'every account is counted under exactly one plan');
select is(
  jsonb_build_object(
    'weekly', pg_temp.rise('{emails,weekly}'), 'health_alerts', pg_temp.rise('{emails,health_alerts}')),
  '{"weekly": 1, "health_alerts": 2}'::jsonb, 'the email choices: one more weekly email, two more health alerts');
select is(
  (select array_agg(e ->> 'day' order by i) from snapshots s,
     jsonb_array_elements(s.body -> 'signups') with ordinality as x (e, i) where s.name = 'after'),
  (select array_agg(to_char(d, 'YYYY-MM-DD') order by d)
   from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d),
  'sign-ups: each of the last 30 days in UTC, today included, oldest first');
select is(
  (select jsonb_object_agg(a.e ->> 'day', (a.e ->> 'count')::integer - (b.e ->> 'count')::integer)
   from snapshots sa, jsonb_array_elements(sa.body -> 'signups') a (e),
        snapshots sb, jsonb_array_elements(sb.body -> 'signups') b (e)
   where sa.name = 'after' and sb.name = 'before' and a.e ->> 'day' = b.e ->> 'day'
     and (a.e ->> 'count')::integer <> (b.e ->> 'count')::integer),
  (select jsonb_object_agg(to_char((now() at time zone 'utc')::date - n, 'YYYY-MM-DD'), 1)
   from unnest(array[0, 3, 10, 20]) n),
  'one more sign-up today, 3, 10 and 20 days ago; none for the accounts older than 30 days');

-- ── The accounts ──────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.names(public.admin_users('console.test')),
  array['e_ve', 'ben', 'dee%50', 'e-ve', 'cy', 'fay', 'dee150', 'ada'], 'by default, the newest account first');
select is((public.admin_users('console.test') ->> 'total')::integer, 8,
  'total counts every account the search matches');
select is(pg_temp.names(public.admin_users('console.test', 'created_at', false)),
  array['ada', 'dee150', 'fay', 'cy', 'e-ve', 'dee%50', 'ben', 'e_ve'], 'or the oldest first');
select is(pg_temp.names(public.admin_users('console.test', 'last_sign_in_at', true)),
  array['e_ve', 'ada', 'ben', 'fay', 'e-ve', 'dee150', 'cy', 'dee%50'],
  'by the last sign-in, newest first, never signed in last');
select is(pg_temp.names(public.admin_users('console.test', 'last_sign_in_at', false)),
  array['dee150', 'e-ve', 'fay', 'ben', 'ada', 'e_ve', 'cy', 'dee%50'], 'and oldest first, never signed in still last');
select is(pg_temp.names(public.admin_users('console.test', 'devices', true)),
  array['ben', 'e_ve', 'fay', 'ada', 'cy', 'dee%50', 'dee150', 'e-ve'], 'by the number of browsers, ties by id');
select is(pg_temp.names(public.admin_users('console.test', 'last_seen_at', false)),
  array['fay', 'ben', 'e_ve', 'ada', 'cy', 'dee%50', 'dee150', 'e-ve'],
  'by when a browser was last seen, oldest first, accounts without one last');
select is(pg_temp.names(public.admin_users('console.test', 'last_seen_at', true)),
  array['e_ve', 'ben', 'fay', 'ada', 'cy', 'dee%50', 'dee150', 'e-ve'], 'and newest first, without one still last');
select is(pg_temp.emails(public.admin_users('console.test', 'email', false)),
  (select array_agg(e order by e) from unnest(pg_temp.emails(public.admin_users('console.test'))) e),
  'by email');
select is(pg_temp.emails(public.admin_users('console.test', 'email', true)),
  (select array_agg(e order by e desc) from unnest(pg_temp.emails(public.admin_users('console.test'))) e),
  'by email, descending');
select is(pg_temp.names(public.admin_users('console.test', page_size => 3, page_index => 1)),
  array['e-ve', 'cy', 'fay'], 'a page at a time');
select is(pg_temp.names(public.admin_users('console.test', page_size => 3, page_index => 2)),
  array['dee150', 'ada'], 'the last page holds what is left');
select is(public.admin_users('console.test', page_size => 3, page_index => 3),
  '{"total": 8, "rows": []}'::jsonb, 'a page past the end is empty, with the total');

select is(
  (public.admin_users('ben@console') -> 'rows' -> 0) - 'created_at' - 'last_sign_in_at' - 'last_seen_at',
  '{"id": "00000000-0000-4000-a000-0000000000c2", "email": "ben@console.test.xomoni.com", "confirmed": true,
    "providers": ["email", "google"], "mfa": false, "banned": false, "superadmin": false, "devices": 2, "jobs": 3,
    "tier": "plus"}'::jsonb,
  'an account''s row: its providers once each, its browsers and jobs counted, its plan as it counts now');
select ok(
  (select (r ->> 'created_at')::timestamptz = now() - interval '3 days'
      and (r ->> 'last_sign_in_at')::timestamptz = now() - interval '2 days'
      and (r ->> 'last_seen_at')::timestamptz = now() - interval '1 day'
   from (select public.admin_users('ben@console') -> 'rows' -> 0 as r) x),
  'and its times, with the newest browser''s');
select is(
  (public.admin_users('dee%50') -> 'rows' -> 0) - 'id' - 'email' - 'created_at',
  '{"last_sign_in_at": null, "confirmed": false, "providers": [], "mfa": false, "banned": false,
    "superadmin": false, "devices": 0, "last_seen_at": null, "jobs": 0, "tier": "free"}'::jsonb,
  'an unconfirmed account with nothing yet, and a revoked plan');
select is(
  (select jsonb_object_agg(split_part(r ->> 'email', '@', 1),
     jsonb_build_object(
       'mfa', r -> 'mfa', 'banned', r -> 'banned', 'superadmin', r -> 'superadmin', 'tier', r -> 'tier'))
   from jsonb_array_elements(public.admin_users('console.test', page_size => 100) -> 'rows') r
   where split_part(r ->> 'email', '@', 1) in ('ada', 'e_ve', 'e-ve')),
  '{"ada": {"mfa": false, "banned": false, "superadmin": true, "tier": "free"},
    "e_ve": {"mfa": true, "banned": true, "superadmin": false, "tier": "pro"},
    "e-ve": {"mfa": false, "banned": false, "superadmin": false, "tier": "free"}}'::jsonb,
  'a super-admin, a confirmed app and a ban in force; an unconfirmed app, a lapsed ban and a lapsed plan count as '
    || 'none');

select is((public.admin_users('BEN@Console') ->> 'total')::integer, 1, 'the search ignores case');
select is(pg_temp.names(public.admin_users('dee%5')), array['dee%50'], 'a % in the search matches only a %');
select is(pg_temp.names(public.admin_users('e_ve')), array['e_ve'], 'and an _ only an _');
select ok(
  (select (p ->> 'total')::integer = (select with_percent from accounts)
      and (p ->> 'total')::integer >= 1
      and (select bool_and(strpos(r ->> 'email', '%') > 0) from jsonb_array_elements(p -> 'rows') r)
   from (select public.admin_users('%', page_size => 100) as p) x),
  'a search of % finds exactly the emails that hold one');
select is((public.admin_users('') ->> 'total')::integer, (select total from accounts),
  'an empty search lists every account');
select is((public.admin_users(null) ->> 'total')::integer, (select total from accounts),
  'and so does none');
select is(jsonb_array_length(public.admin_users() -> 'rows'), least(25, (select total from accounts)),
  'a page holds 25 accounts by default');

select throws_ok($$ select public.admin_users(sort => 'encrypted_password') $$, '22023', null,
  'a sort by anything else is refused');
select throws_ok($$ select public.admin_users(page_size => 0) $$, '22023', null, 'so is a page of no accounts');
select throws_ok($$ select public.admin_users(page_size => 101) $$, '22023', null, 'or of more than 100');
select throws_ok($$ select public.admin_users(page_index => -1) $$, '22023', null, 'or a page before the first');

-- ── One account ───────────────────────────────────────────────────────────────────────────────────
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.admin_user('00000000-0000-4000-a000-0000000000c2')) k),
  array['banned', 'banned_until', 'choices', 'confirmed', 'created_at', 'devices', 'email', 'id', 'jobs',
    'last_sign_in_at', 'mfa', 'plan', 'providers', 'sessions', 'superadmin'],
  'an account''s page has what the console shows, and nothing else');
select is(
  public.admin_user('00000000-0000-4000-a000-0000000000c2')
    - 'created_at' - 'last_sign_in_at' - 'plan' - 'devices' - 'jobs',
  '{"id": "00000000-0000-4000-a000-0000000000c2", "email": "ben@console.test.xomoni.com", "confirmed": true,
    "providers": ["email", "google"], "mfa": false, "banned": false, "banned_until": null, "superadmin": false,
    "choices": {"daily_stats": true, "weekly_email": true, "health_alert": true}, "sessions": 2}'::jsonb,
  'Ben: his providers, his email choices and his two sessions');
select is((public.admin_user('00000000-0000-4000-a000-0000000000c2') -> 'plan') - 'valid_until',
  '{"tier": "plus", "status": "active"}'::jsonb, 'his plan, as entitlement_of() gives it');
select is(public.admin_user('00000000-0000-4000-a000-0000000000c4') -> 'choices',
  '{"daily_stats": true, "weekly_email": false, "health_alert": false}'::jsonb,
  'a choice turned off, or never made, is false');
select is(
  public.admin_user('00000000-0000-4000-a000-0000000000c2') -> 'devices',
  jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-d000-0000000001c2',
      'name', 'Ben laptop', 'extension_version', '0.6.0',
      'last_seen_at', now() - interval '1 day', 'created_at', now() - interval '3 days'),
    jsonb_build_object('id', '00000000-0000-4000-d000-0000000002c2',
      'name', 'Ben desktop', 'extension_version', '0.5.3',
      'last_seen_at', now() - interval '20 days', 'created_at', now() - interval '3 days')),
  'his browsers, the most recently seen first');
select is(
  (select jsonb_agg(j - 'id' - 'updated_at' order by i)
   from jsonb_array_elements(public.admin_user('00000000-0000-4000-a000-0000000000c2') -> 'jobs')
     with ordinality as x (j, i)),
  '[{"kind": "cleanup", "title": "Delete old posts", "state": "running", "x_handle": "ben", "matched": 10, "done": 4,
     "failed": 1},
    {"kind": "scan", "title": "Scan likes", "state": "paused", "x_handle": "ben", "matched": 0, "done": 0, "failed": 0},
    {"kind": "cleanup", "title": "Delete replies", "state": "failed", "x_handle": "ben", "matched": 5, "done": 2,
     "failed": 3}]'::jsonb,
  'his jobs, the most recently updated first, with their counts');
select is(public.admin_user('00000000-0000-4000-a000-0000000000c5') -> 'banned_until',
  to_jsonb(now() + interval '1 day'), 'a ban says until when');
select ok(public.admin_user('00000000-0000-4000-a000-0000000000ff') is null, 'an account that doesn''t exist is null');

-- Eve gets 25 more jobs, an hour apart: the page shows the 20 most recently updated.
reset role;
insert into public.jobs (user_id, device_id, local_id, x_handle, kind, title, state, updated_at)
select '00000000-0000-4000-a000-0000000000c5', '00000000-0000-4000-d000-0000000000c5', 'more-' || n, 'eve', 'scan',
  'Scan ' || n, 'completed', now() - n * interval '1 hour'
from generate_series(1, 25) n;
set local role authenticated;
select is(
  (select array_agg(j ->> 'title' order by i)
   from jsonb_array_elements(public.admin_user('00000000-0000-4000-a000-0000000000c5') -> 'jobs')
     with ordinality as x (j, i)),
  array['Scan posts'] || (select array_agg('Scan ' || n order by n) from generate_series(1, 19) n),
  'an account''s 20 most recently updated jobs, no more');

-- ── Refusals before any act ───────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c1', true) $$, '42501', null,
  'a super-admin can''t ban herself');
select throws_ok($$ select public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c1') $$, '42501', null,
  'nor sign herself out here');
select throws_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000c1') $$, '42501', null,
  'nor delete her own account here');
select throws_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c3', true) $$, '42501', null,
  'nor ban another super-admin');
select throws_ok($$ select public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c3') $$, '42501', null,
  'nor sign one out');
select throws_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000c3') $$, '42501', null,
  'nor delete one');
select throws_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000ff', true) $$, 'P0002', null,
  'banning an account that doesn''t exist says so');
select throws_ok($$ select public.admin_sign_out_user('00000000-0000-4000-a000-0000000000ff') $$, 'P0002', null,
  'so does signing one out');
select throws_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000ff') $$, 'P0002', null,
  'and deleting one');
select throws_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c2', null) $$, '22023', null,
  'a ban must say whether');
select is((select count(*)::integer from public.admin_audit where actor = '00000000-0000-4000-a000-0000000000c1'), 0,
  'and nothing refused was logged');

-- ── Banning ───────────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c2', true) $$, 'Ada bans Ben');
reset role;
select is((select banned_until from auth.users where id = '00000000-0000-4000-a000-0000000000c2'),
  '9999-12-31 00:00:00+00'::timestamptz, 'until the year 9999, which Supabase Auth can read (infinity it can''t)');
select is((select count(*)::integer from auth.sessions where user_id = '00000000-0000-4000-a000-0000000000c2'), 0,
  'his sessions end');
select is((select count(*)::integer from auth.refresh_tokens where user_id = '00000000-0000-4000-a000-0000000000c2'),
  0, 'with every refresh token, even one without a session');
set local role authenticated;
select is(public.admin_user('00000000-0000-4000-a000-0000000000c2') -> 'banned', 'true'::jsonb,
  'the console shows him banned');
select lives_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c2', false) $$,
  'Ada lifts the ban');
reset role;
select ok((select banned_until is null from auth.users where id = '00000000-0000-4000-a000-0000000000c2'),
  'his banned_until is cleared');
set local role authenticated;

-- ── Signing out ───────────────────────────────────────────────────────────────────────────────────
select is(public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c5'), 1,
  'signing Eve out ends her one session');
reset role;
select is((select count(*)::integer from auth.sessions where user_id = '00000000-0000-4000-a000-0000000000c5'), 0,
  'she has none left');
set local role authenticated;
select is(public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c5'), 0, 'a second time ends none');

-- ── Deleting ──────────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000c6') $$, 'Ada deletes Fay');
reset role;
select ok(
  not exists (select 1 from auth.users where id = '00000000-0000-4000-a000-0000000000c6')
    and not exists (select 1 from public.devices where user_id = '00000000-0000-4000-a000-0000000000c6')
    and not exists (select 1 from public.jobs where user_id = '00000000-0000-4000-a000-0000000000c6')
    and not exists (select 1 from auth.sessions where user_id = '00000000-0000-4000-a000-0000000000c6'),
  'her account goes, with her browsers, jobs and sessions');
set local role authenticated;
select ok(public.admin_user('00000000-0000-4000-a000-0000000000c6') is null, 'and the console finds her no more');

-- ── The log ───────────────────────────────────────────────────────────────────────────────────────
select is(
  (select jsonb_agg(jsonb_build_array(e ->> 'action', split_part(e ->> 'target', '-', 5), e -> 'detail') order by i)
   from jsonb_array_elements(public.admin_audit_log()) with ordinality as x (e, i)
   where e ->> 'actor' = '00000000-0000-4000-a000-0000000000c1'),
  '[["delete", "0000000000c6", {"email_domain": "console.test.xomoni.com"}],
    ["sign_out", "0000000000c5", {"sessions": 0}], ["sign_out", "0000000000c5", {"sessions": 1}],
    ["unban", "0000000000c2", {}], ["ban", "0000000000c2", {}]]'::jsonb,
  'the log, newest first: every act, its account, and for a deletion only the email''s domain');
select is((public.admin_audit_log() -> 0) - 'id' - 'created_at',
  '{"actor": "00000000-0000-4000-a000-0000000000c1", "actor_email": "ada@console.test.xomoni.com", "action": "delete",
    "target": "00000000-0000-4000-a000-0000000000c6", "target_email": null,
    "detail": {"email_domain": "console.test.xomoni.com"}}'::jsonb,
  'an entry names who acted; a deleted account keeps its id but has no email');
select is(public.admin_audit_log() -> 1 ->> 'target_email', 'e_ve@console.test.xomoni.com',
  'an account that still exists has its email');
select is(jsonb_array_length(public.admin_audit_log(1)), 1, 'the log comes a page at a time');
select is(public.admin_audit_log(1) -> 0 ->> 'action', 'delete', 'the newest first');
select throws_ok($$ select public.admin_audit_log(0) $$, '22023', null, 'a page of no entries is refused');
select throws_ok($$ select public.admin_audit_log(201) $$, '22023', null, 'so is one of more than 200');
select is((select count(*)::integer from public.admin_audit where actor = '00000000-0000-4000-a000-0000000000c1'), 5,
  'a super-admin reads the log table too');
select throws_ok(
  $$ insert into public.admin_audit (action, target) values ('ban', '00000000-0000-4000-a000-0000000000c2') $$,
  '42501', null, 'but nobody writes it through the Data API');
select throws_ok($$ update public.admin_audit set action = 'unban' $$, '42501', null, 'nor changes an entry');
select throws_ok($$ delete from public.admin_audit $$, '42501', null, 'nor deletes one');

-- ── The product plan ──────────────────────────────────────────────────────────────────────────────
reset role;
insert into public.product_plan (data) values ('{"next": "the console"}')
on conflict (id) do update set data = excluded.data;
set local role authenticated;
select is((select data from public.product_plan), '{"next": "the console"}'::jsonb, 'a super-admin reads the plan');
select throws_ok($$ insert into public.product_plan (id, data) values (true, '{}') $$, '42501', null,
  'but doesn''t write it');
select throws_ok($$ update public.product_plan set data = '{}' $$, '42501', null, 'nor change it');
select throws_ok($$ delete from public.product_plan $$, '42501', null, 'nor delete it');

-- ── An ordinary account ───────────────────────────────────────────────────────────────────────────
select pg_temp.session('00000000-0000-4000-a000-0000000000c2', 'aal1');
select throws_ok($$ select public.admin_overview() $$, '42501', 'Not allowed.', 'Ben can''t read the overview');
select throws_ok($$ select public.admin_users() $$, '42501', 'Not allowed.', 'nor the accounts');
select throws_ok($$ select public.admin_user('00000000-0000-4000-a000-0000000000c2') $$, '42501', 'Not allowed.',
  'nor an account, even his own');
select throws_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c4', true) $$, '42501',
  'Not allowed.', 'nor ban one');
select throws_ok($$ select public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c4') $$, '42501',
  'Not allowed.', 'nor sign one out');
select throws_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000c4') $$, '42501',
  'Not allowed.', 'nor delete one');
select throws_ok($$ select public.admin_audit_log() $$, '42501', 'Not allowed.', 'nor the log through its function');
select is((select count(*)::integer from public.admin_audit), 0, 'nor the log table');
select is((select count(*)::integer from public.product_plan), 0, 'nor the product plan');

-- ── A super-admin with an authenticator app, before the code ──────────────────────────────────────
select pg_temp.session('00000000-0000-4000-a000-0000000000c3', 'aal1');
select throws_ok($$ select public.admin_overview() $$, '42501', 'Not allowed.', 'Cy at aal1 can''t read the overview');
select throws_ok($$ select public.admin_users() $$, '42501', 'Not allowed.', 'nor the accounts');
select throws_ok($$ select public.admin_user('00000000-0000-4000-a000-0000000000c2') $$, '42501', 'Not allowed.',
  'nor an account');
select throws_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c7', true) $$, '42501',
  'Not allowed.', 'nor ban one');
select throws_ok($$ select public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c7') $$, '42501',
  'Not allowed.', 'nor sign one out');
select throws_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000c8') $$, '42501',
  'Not allowed.', 'nor delete one');
select throws_ok($$ select public.admin_audit_log() $$, '42501', 'Not allowed.', 'nor read the log');
select is((select count(*)::integer from public.admin_audit), 0, 'nor the log table');
select is((select count(*)::integer from public.product_plan), 0, 'nor the product plan');

-- ── And after the code ────────────────────────────────────────────────────────────────────────────
select pg_temp.session('00000000-0000-4000-a000-0000000000c3', 'aal2');
select is((public.admin_overview() #>> '{users,total}')::integer, (select total from accounts),
  'Cy at aal2 reads the overview');
select is((public.admin_users('console.test') ->> 'total')::integer, 7, 'and the accounts');
select is(public.admin_user('00000000-0000-4000-a000-0000000000c2') ->> 'email', 'ben@console.test.xomoni.com',
  'and an account');
select lives_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c7', true) $$, 'she bans one');
select is(public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c7'), 0, 'signs one out');
select lives_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000c8') $$, 'and deletes one');
select is(
  (select jsonb_agg(jsonb_build_array(e ->> 'action', e ->> 'actor_email') order by i)
   from jsonb_array_elements(public.admin_audit_log(3)) with ordinality as x (e, i)),
  '[["delete", "cy@console.test.xomoni.com"], ["sign_out", "cy@console.test.xomoni.com"],
    ["ban", "cy@console.test.xomoni.com"]]'::jsonb,
  'and reads the log, with her own acts first');
select is((select count(*)::integer from public.admin_audit
  where actor in ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-0000000000c3')), 8,
  'and the log table');
select is((select count(*)::integer from public.product_plan), 1, 'and the product plan');

-- ── anon ──────────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select public.admin_overview() $$, '42501', null, 'anon can''t call the overview');
select throws_ok($$ select public.admin_users() $$, '42501', null, 'nor the accounts');
select throws_ok($$ select public.admin_user('00000000-0000-4000-a000-0000000000c2') $$, '42501', null,
  'nor an account');
select throws_ok($$ select public.admin_set_banned('00000000-0000-4000-a000-0000000000c2', true) $$, '42501', null,
  'nor a ban');
select throws_ok($$ select public.admin_sign_out_user('00000000-0000-4000-a000-0000000000c2') $$, '42501', null,
  'nor a sign-out');
select throws_ok($$ select public.admin_delete_user('00000000-0000-4000-a000-0000000000c2') $$, '42501', null,
  'nor a deletion');
select throws_ok($$ select public.admin_audit_log() $$, '42501', null, 'nor the log');
select throws_ok($$ select * from public.admin_audit $$, '42501', null, 'nor read the log table');
select throws_ok($$ select * from public.product_plan $$, '42501', null, 'nor the product plan');

-- ── The log outlives the super-admin who acted ────────────────────────────────────────────────────
reset role;
delete from auth.users where id = '00000000-0000-4000-a000-0000000000c1';
set local role authenticated;
select pg_temp.session('00000000-0000-4000-a000-0000000000c3', 'aal2');
select is(
  (select jsonb_build_object('acts', count(*), 'emails', jsonb_agg(distinct e -> 'actor_email'))
   from jsonb_array_elements(public.admin_audit_log()) e
   where e ->> 'actor' = '00000000-0000-4000-a000-0000000000c1'),
  '{"acts": 5, "emails": [null]}'::jsonb,
  'when Ada''s account is deleted, her five acts stay, with her id and no email');

select * from finish();
rollback;
