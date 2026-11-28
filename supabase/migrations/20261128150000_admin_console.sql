-- The super-admin console (#516): what the site's super-admins (ADR-0048) see and do at /admin, through functions the
-- signed-in person calls, so the website still holds no service-role key. Each function first checks that the caller
-- is a super-admin whose session meets the two-step rule (an account with an authenticator app needs aal2, ADR-0036),
-- and otherwise refuses with 42501. They show counts, dates, plans and choices about accounts: never a password hash,
-- a token, X content (ADR-0004), or anything of an account's metadata but its sign-in providers. They can ban, sign out
-- or delete any account but the caller's own and another super-admin's, and each such act is written to `admin_audit`,
-- which keeps it after either account is gone. `product_plan` holds the maintainer's private plan: one row, written by
-- their own tool as the postgres role, which only super-admins read. No migration names a person.

-- ── What super-admins did ────────────────────────────────────────────────────────────────────────
-- One row per ban, unban, sign-out or deletion. `actor` and `target` have no foreign key, so a row outlives both
-- accounts; a deleted account is remembered only by its email's domain, in `detail`.
create table public.admin_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor uuid,
  action text not null check (action in ('ban', 'unban', 'sign_out', 'delete')),
  target uuid,
  detail jsonb not null default '{}'::jsonb
);

create index admin_audit_created_at on public.admin_audit (created_at desc, id desc);

alter table public.admin_audit enable row level security;

create policy "Super-admins read the console's log" on public.admin_audit
  for select to authenticated using ((select public.is_superadmin()));

-- As for the product documents (ADR-0048): an account with an authenticator app reads only at aal2.
create policy "Accounts with an authenticator app need aal2 to read" on public.admin_audit
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

-- Read only: only the functions below write it.
grant select on public.admin_audit to authenticated;
grant select on public.admin_audit to service_role;

-- ── The maintainer's private plan ────────────────────────────────────────────────────────────────
-- One row, whatever the maintainer's tool writes; never in the public repository.
create table public.product_plan (
  id boolean primary key default true check (id),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.product_plan enable row level security;

create policy "Super-admins read the product plan" on public.product_plan
  for select to authenticated using ((select public.is_superadmin()));

create policy "Accounts with an authenticator app need aal2 to read" on public.product_plan
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

grant select on public.product_plan to authenticated;
grant select, insert, update, delete on public.product_plan to service_role;

-- ── The whole service at a glance ────────────────────────────────────────────────────────────────
-- Counts of accounts, browsers, jobs, plans (as they count now) and email choices, and sign-ups for each of the last
-- 30 days in UTC, today included and oldest first.
create function public.admin_overview() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  if not coalesce(public.is_superadmin() and public.mfa_satisfied(), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (
      select jsonb_build_object(
        'total', count(*)::integer,
        'confirmed', (count(*) filter (where u.email_confirmed_at is not null))::integer,
        'new_7d', (count(*) filter (where u.created_at >= now() - interval '7 days'))::integer,
        'new_30d', (count(*) filter (where u.created_at >= now() - interval '30 days'))::integer,
        'signed_in_30d', (count(*) filter (where u.last_sign_in_at >= now() - interval '30 days'))::integer,
        'with_mfa', (select count(distinct f.user_id)::integer from auth.mfa_factors f where f.status = 'verified'),
        'banned', (count(*) filter (where u.banned_until > now()))::integer)
      from auth.users u),
    'devices', jsonb_build_object(
      'total', (select count(*)::integer from public.devices),
      'active_7d', (select count(*)::integer from public.devices d where d.last_seen_at >= now() - interval '7 days'),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object('version', v.extension_version, 'devices', v.devices)
          order by v.devices desc, v.extension_version)
        from (
          select d.extension_version, count(*)::integer as devices
          from public.devices d group by d.extension_version) v), '[]'::jsonb)),
    'jobs', (
      select jsonb_build_object(
        'total', count(*)::integer,
        'running', (count(*) filter (where j.state = 'running'))::integer,
        'waiting', (count(*) filter (where j.state in ('waiting', 'blocked', 'paused', 'queued')))::integer,
        'finished_7d', (count(*) filter (
          where j.state in ('completed', 'cancelled', 'failed')
            and j.updated_at >= now() - interval '7 days'))::integer)
      from public.jobs j),
    -- Every account, by the plan that counts now: free without one.
    'plans', (
      select jsonb_agg(jsonb_build_object('tier', t.tier, 'accounts', coalesce(c.accounts, 0)) order by t.place)
      from (values ('free', 1), ('plus', 2), ('pro', 3)) as t (tier, place)
      left join (
        select public.entitlement_of(u.id) ->> 'tier' as tier, count(*)::integer as accounts
        from auth.users u group by 1) c on c.tier = t.tier),
    'emails', jsonb_build_object(
      'weekly', (select count(*)::integer from public.weekly_emails w where w.enabled),
      'health_alerts', (select count(*)::integer from public.health_alerts h where h.enabled)),
    'signups', (
      select jsonb_agg(jsonb_build_object(
          'day', to_char((today - n)::timestamp, 'YYYY-MM-DD'), 'count', coalesce(c.signups, 0))
        order by n desc)
      from generate_series(0, 29) as n
      left join (
        select (u.created_at at time zone 'utc')::date as day, count(*)::integer as signups
        from auth.users u
        where u.created_at >= (today - 29)::timestamp at time zone 'utc'
        group by 1) c on c.day = today - n));
end;
$$;

revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- ── Accounts, a page at a time ───────────────────────────────────────────────────────────────────
-- `search` is a substring of the email in any case, where % and _ match only themselves; null or '' lists all. `total`
-- counts every account the search matches. Sorted by `sort` with nulls last either way, then by id.
create function public.admin_users(
  search text default null,
  sort text default 'created_at',
  descending boolean default true,
  page_size integer default 25,
  page_index integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pattern text;
  down boolean := coalesce(admin_users.descending, true);
  skip bigint;
  result jsonb;
begin
  if not coalesce(public.is_superadmin() and public.mfa_satisfied(), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if admin_users.sort is null
     or admin_users.sort not in ('created_at', 'last_sign_in_at', 'email', 'devices', 'last_seen_at') then
    raise exception 'Sort by created_at, last_sign_in_at, email, devices or last_seen_at.' using errcode = '22023';
  end if;
  if admin_users.page_size is null or admin_users.page_size not between 1 and 100 then
    raise exception 'A page holds 1 to 100 accounts.' using errcode = '22023';
  end if;
  if admin_users.page_index is null or admin_users.page_index < 0 then
    raise exception 'Pages are numbered from 0.' using errcode = '22023';
  end if;
  if coalesce(admin_users.search, '') <> '' then
    pattern := '%' || replace(replace(replace(admin_users.search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  skip := admin_users.page_size::bigint * admin_users.page_index;

  with matching as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until,
      coalesce(d.devices, 0) as devices, d.last_seen_at
    from auth.users u
    left join (
      select v.user_id, count(*)::integer as devices, max(v.last_seen_at) as last_seen_at
      from public.devices v group by v.user_id) d on d.user_id = u.id
    where pattern is null or u.email ilike pattern
  ),
  ranked as (
    select m.*, row_number() over (order by
      case when admin_users.sort = 'created_at' and not down then m.created_at end asc nulls last,
      case when admin_users.sort = 'created_at' and down then m.created_at end desc nulls last,
      case when admin_users.sort = 'last_sign_in_at' and not down then m.last_sign_in_at end asc nulls last,
      case when admin_users.sort = 'last_sign_in_at' and down then m.last_sign_in_at end desc nulls last,
      case when admin_users.sort = 'email' and not down then m.email end asc nulls last,
      case when admin_users.sort = 'email' and down then m.email end desc nulls last,
      case when admin_users.sort = 'devices' and not down then m.devices end asc nulls last,
      case when admin_users.sort = 'devices' and down then m.devices end desc nulls last,
      case when admin_users.sort = 'last_seen_at' and not down then m.last_seen_at end asc nulls last,
      case when admin_users.sort = 'last_seen_at' and down then m.last_seen_at end desc nulls last,
      m.id) as place
    from matching m
  )
  select jsonb_build_object(
    'total', (select count(*)::integer from matching),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'email', r.email,
          'created_at', r.created_at,
          'last_sign_in_at', r.last_sign_in_at,
          'confirmed', r.email_confirmed_at is not null,
          'providers', coalesce((
            select jsonb_agg(p.provider order by p.provider)
            from (select distinct i.provider from auth.identities i where i.user_id = r.id) p), '[]'::jsonb),
          'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = r.id and f.status = 'verified'),
          'banned', coalesce(r.banned_until > now(), false),
          'superadmin', exists (select 1 from public.app_admins a where a.user_id = r.id and a.role = 'superadmin'),
          'devices', r.devices,
          'last_seen_at', r.last_seen_at,
          'jobs', (select count(*)::integer from public.jobs j where j.user_id = r.id),
          'tier', public.entitlement_of(r.id) ->> 'tier')
        order by r.place)
      from ranked r
      where r.place > skip and r.place <= skip + admin_users.page_size), '[]'::jsonb))
  into result;
  return result;
end;
$$;

revoke execute on function public.admin_users(text, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_users(text, text, boolean, integer, integer) to authenticated;

-- ── One account ──────────────────────────────────────────────────────────────────────────────────
-- Null when there is no such account. Its browsers, newest seen first; its 20 most recently updated jobs, counts only;
-- and how many sessions it has.
create function public.admin_user(target uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_superadmin() and public.mfa_satisfied(), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'confirmed', u.email_confirmed_at is not null,
      'providers', coalesce((
        select jsonb_agg(p.provider order by p.provider)
        from (select distinct i.provider from auth.identities i where i.user_id = u.id) p), '[]'::jsonb),
      'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
      'banned', coalesce(u.banned_until > now(), false),
      'banned_until', u.banned_until,
      'superadmin', exists (select 1 from public.app_admins a where a.user_id = u.id and a.role = 'superadmin'),
      'plan', public.entitlement_of(u.id),
      'choices', jsonb_build_object(
        'daily_stats', coalesce((select c.enabled from public.daily_stats_choices c where c.user_id = u.id), false),
        'weekly_email', coalesce((select w.enabled from public.weekly_emails w where w.user_id = u.id), false),
        'health_alert', coalesce((select h.enabled from public.health_alerts h where h.user_id = u.id), false)),
      'devices', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', d.id, 'name', d.name, 'extension_version', d.extension_version,
            'last_seen_at', d.last_seen_at, 'created_at', d.created_at)
          order by d.last_seen_at desc, d.id)
        from public.devices d where d.user_id = u.id), '[]'::jsonb),
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', j.id, 'kind', j.kind, 'title', j.title, 'state', j.state, 'x_handle', j.x_handle,
            'matched', j.matched, 'done', j.done, 'failed', j.failed, 'updated_at', j.updated_at)
          order by j.updated_at desc, j.id)
        from (
          select * from public.jobs j
          where j.user_id = u.id
          order by j.updated_at desc, j.id
          limit 20) j), '[]'::jsonb),
      'sessions', (select count(*)::integer from auth.sessions s where s.user_id = u.id))
    from auth.users u
    where u.id = admin_user.target);
end;
$$;

revoke execute on function public.admin_user(uuid) from public, anon;
grant execute on function public.admin_user(uuid) to authenticated;

-- ── Acting on an account ─────────────────────────────────────────────────────────────────────────
-- Each refuses, before doing anything: a caller who isn't a super-admin at the right level and the caller's own account
-- (42501), an account that doesn't exist (P0002), and another super-admin's (42501).

-- Bans an account until the year 9999, ending its sessions, or lifts the ban. Not `infinity`: Supabase Auth can't read
-- an infinite `banned_until`, and fails every request that loads the account, its admin list among them.
create function public.admin_set_banned(target uuid, banned boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_superadmin() and public.mfa_satisfied(), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if admin_set_banned.target = (select auth.uid()) then
    raise exception 'Not on your own account.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = admin_set_banned.target) then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.app_admins a where a.user_id = admin_set_banned.target) then
    raise exception 'Not on a super-admin''s account.' using errcode = '42501';
  end if;
  if admin_set_banned.banned is null then
    raise exception 'Say whether to ban the account.' using errcode = '22023';
  end if;

  if admin_set_banned.banned then
    update auth.users u set banned_until = '9999-12-31 00:00:00+00', updated_at = now()
    where u.id = admin_set_banned.target;
    -- Its refresh tokens go with its sessions; a token from before sessions existed goes by the account.
    delete from auth.sessions s where s.user_id = admin_set_banned.target;
    delete from auth.refresh_tokens t where t.user_id = admin_set_banned.target::text;
  else
    update auth.users u set banned_until = null, updated_at = now() where u.id = admin_set_banned.target;
  end if;
  insert into public.admin_audit (actor, action, target)
  values ((select auth.uid()), case when admin_set_banned.banned then 'ban' else 'unban' end, admin_set_banned.target);
end;
$$;

revoke execute on function public.admin_set_banned(uuid, boolean) from public, anon;
grant execute on function public.admin_set_banned(uuid, boolean) to authenticated;

-- Ends every session of the account, which then signs in again; returns how many there were.
create function public.admin_sign_out_user(target uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ended integer;
begin
  if not coalesce(public.is_superadmin() and public.mfa_satisfied(), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if admin_sign_out_user.target = (select auth.uid()) then
    raise exception 'Not on your own account.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = admin_sign_out_user.target) then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.app_admins a where a.user_id = admin_sign_out_user.target) then
    raise exception 'Not on a super-admin''s account.' using errcode = '42501';
  end if;

  delete from auth.sessions s where s.user_id = admin_sign_out_user.target;
  get diagnostics ended = row_count;
  delete from auth.refresh_tokens t where t.user_id = admin_sign_out_user.target::text;
  insert into public.admin_audit (actor, action, target, detail)
  values ((select auth.uid()), 'sign_out', admin_sign_out_user.target, jsonb_build_object('sessions', ended));
  return ended;
end;
$$;

revoke execute on function public.admin_sign_out_user(uuid) from public, anon;
grant execute on function public.admin_sign_out_user(uuid) to authenticated;

-- Deletes the account as delete_account() does: its browsers, jobs, numbers, choices and plan go with it. The log keeps
-- the act, with the domain of the account's email and nothing else about it.
create function public.admin_delete_user(target uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_domain text;
begin
  if not coalesce(public.is_superadmin() and public.mfa_satisfied(), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if admin_delete_user.target = (select auth.uid()) then
    raise exception 'Not on your own account.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = admin_delete_user.target) then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.app_admins a where a.user_id = admin_delete_user.target) then
    raise exception 'Not on a super-admin''s account.' using errcode = '42501';
  end if;

  select lower(substring(u.email from '@([^@]*)$')) into email_domain
  from auth.users u where u.id = admin_delete_user.target;
  insert into public.admin_audit (actor, action, target, detail)
  values ((select auth.uid()), 'delete', admin_delete_user.target, jsonb_build_object('email_domain', email_domain));
  delete from auth.users u where u.id = admin_delete_user.target;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ── The log ──────────────────────────────────────────────────────────────────────────────────────
-- The newest `page_size` acts, newest first, with each account's email while the account exists.
create function public.admin_audit_log(page_size integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_superadmin() and public.mfa_satisfied(), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if admin_audit_log.page_size is null or admin_audit_log.page_size not between 1 and 200 then
    raise exception 'A page holds 1 to 200 entries.' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'created_at', a.created_at,
        'actor', a.actor,
        'actor_email', (select u.email from auth.users u where u.id = a.actor),
        'action', a.action,
        'target', a.target,
        'target_email', (select u.email from auth.users u where u.id = a.target),
        'detail', a.detail)
      order by a.created_at desc, a.id desc)
    from (
      select * from public.admin_audit l
      order by l.created_at desc, l.id desc
      limit admin_audit_log.page_size) a), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_audit_log(integer) from public, anon;
grant execute on function public.admin_audit_log(integer) to authenticated;
