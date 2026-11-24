-- Payments (#420, ADR-0042): each Xomoni account's plan, the ledger of Polar's webhook deliveries, and the one switch
-- that opens sales. The cloud keeps the plan and nothing else about a payment: no email, name, address, card or event
-- body, and no X content (ADR-0004, amended by ADR-0042). Only a signed webhook writes, through apply_billing_event(),
-- which only service_role may run. A person reads their own plan; the extension reads its account's plan in the answer
-- of device_report, beside `stats`. Deleting the account deletes the plan.

-- ── The plan: one row per account ─────────────────────────────────────────────────────────────────
create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null check (tier in ('free', 'plus', 'pro')),
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'revoked')),
  -- A subscription, or a one-time pass (such as 30 days of Plus).
  source text not null check (source in ('subscription', 'pass')),
  -- The end of the period paid for. A paid plan always has one, so a lost event can't leave a plan that never ends.
  valid_until timestamptz,
  cancel_at_period_end boolean not null default false,
  founding boolean not null default false,
  -- Polar's own ids, to find the customer and the subscription there; never an email or a name.
  polar_customer_id text check (char_length(polar_customer_id) between 1 and 100),
  polar_subscription_id text check (char_length(polar_subscription_id) between 1 and 100),
  -- When Polar made the event this row comes from: an event older than it changes nothing.
  event_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint entitlements_paid_plan_ends check (tier = 'free' or valid_until is not null)
);

alter table public.entitlements enable row level security;

create policy "Owners read their plan" on public.entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

-- As for the account's other data (ADR-0036): an account with an authenticator app reads it only at aal2.
create policy "Accounts with an authenticator app need aal2" on public.entitlements
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

-- Read only: every write goes through apply_billing_event().
grant select on public.entitlements to authenticated;

-- ── The ledger: one row per webhook delivery, never its body ─────────────────────────────────────
create table public.billing_events (
  -- Standard Webhooks' `webhook-id`: the same for every retry of one event.
  webhook_id text primary key check (char_length(webhook_id) between 1 and 200),
  type text not null check (type ~ '^[a-z][a-z_.]{0,63}$'),
  received_at timestamptz not null default now(),
  -- applied: it changed the plan; stale: older than the plan, so it changed nothing; ignored: it named no account.
  result text not null check (result in ('applied', 'ignored', 'stale'))
);

-- ── The switch: one row, off until the maintainer opens sales ────────────────────────────────────
create table public.billing_settings (
  id boolean primary key default true check (id),
  live boolean not null default false,
  changed_at timestamptz not null default now()
);

insert into public.billing_settings (id, live) values (true, false);

-- Row Level Security with no policy: neither anon nor authenticated reads or writes the ledger or the switch.
alter table public.billing_events enable row level security;
alter table public.billing_settings enable row level security;

-- The admin role reads all three, as it does the other tables (#149's hardening), so the local stack's tests can check
-- what a webhook did. It writes the plan only through the function below. The apps never hold this key outside the
-- webhook's server-only module (ADR-0042).
grant select on public.entitlements, public.billing_events, public.billing_settings to service_role;

-- ── An account's plan as it counts now ───────────────────────────────────────────────────────────
-- `tier` is the plan that counts now: free without a row, once revoked, or once `valid_until` has passed. `status` and
-- `valid_until` are as stored, so a closed plan can still say when it ended.
create function public.entitlement_of(owner uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'tier', case when e.status = 'revoked' or e.valid_until <= now() then 'free' else e.tier end,
       'status', e.status,
       'valid_until', e.valid_until)
     from public.entitlements e
     where e.user_id = owner),
    jsonb_build_object('tier', 'free', 'status', null, 'valid_until', null))
$$;

revoke execute on function public.entitlement_of(uuid) from public, anon, authenticated;

-- Whether sales are open (ADR-0042): until then, every paid feature opens with a *Plus · preview* badge.
create function public.billing_live() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.live from public.billing_settings s where s.id), false)
$$;

revoke execute on function public.billing_live() from public, anon, authenticated;

-- ── The only writer: a webhook Polar signed ──────────────────────────────────────────────────────
-- Applies one Polar event, already verified and parsed by the website's webhook route, to one account's plan. Each
-- event takes effect once: a webhook id seen before is `ignored` and changes nothing, an event older than the plan is
-- `stale`, and an event for an account that no longer exists is `ignored`. Returns the result, which the ledger keeps.
-- An event from more than 10 minutes in the future is refused: it would make every later event look stale.
create function public.apply_billing_event(
  webhook_id text,
  event_type text,
  event_at timestamptz,
  user_id uuid,
  tier text,
  status text,
  source text,
  valid_until timestamptz,
  cancel_at_period_end boolean default false,
  founding boolean default false,
  polar_customer_id text default null,
  polar_subscription_id text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  outcome text;
  changed integer;
begin
  if apply_billing_event.webhook_id is null or char_length(apply_billing_event.webhook_id) not between 1 and 200 then
    raise exception 'An event needs its webhook id.' using errcode = '22023', hint = 'bad_event';
  end if;
  if apply_billing_event.event_type is null or apply_billing_event.event_type !~ '^[a-z][a-z_.]{0,63}$' then
    raise exception 'An event needs its type.' using errcode = '22023', hint = 'bad_event';
  end if;
  if apply_billing_event.event_at is null or apply_billing_event.event_at > now() + interval '10 minutes' then
    raise exception 'An event needs a time that has come.' using errcode = '22023', hint = 'bad_event';
  end if;
  if apply_billing_event.user_id is null then
    raise exception 'An event needs the account it is for.' using errcode = '22023', hint = 'bad_event';
  end if;

  -- The ledger first: a repeat delivery stops here. A delivery of the same id at the same moment waits for this one.
  insert into public.billing_events (webhook_id, type, result)
  values (apply_billing_event.webhook_id, apply_billing_event.event_type, 'applied')
  on conflict on constraint billing_events_pkey do nothing;
  get diagnostics changed = row_count;
  if changed = 0 then
    return 'ignored';
  end if;

  if not exists (select 1 from auth.users u where u.id = apply_billing_event.user_id) then
    outcome := 'ignored';
  else
    insert into public.entitlements as e (
      user_id, tier, status, source, valid_until, cancel_at_period_end, founding,
      polar_customer_id, polar_subscription_id, event_at, updated_at
    ) values (
      apply_billing_event.user_id, apply_billing_event.tier, apply_billing_event.status, apply_billing_event.source,
      apply_billing_event.valid_until, coalesce(apply_billing_event.cancel_at_period_end, false),
      coalesce(apply_billing_event.founding, false), apply_billing_event.polar_customer_id,
      apply_billing_event.polar_subscription_id, apply_billing_event.event_at, now()
    )
    on conflict on constraint entitlements_pkey do update set
      tier = excluded.tier, status = excluded.status, source = excluded.source, valid_until = excluded.valid_until,
      cancel_at_period_end = excluded.cancel_at_period_end, founding = excluded.founding,
      polar_customer_id = excluded.polar_customer_id, polar_subscription_id = excluded.polar_subscription_id,
      event_at = excluded.event_at, updated_at = now()
    -- An older event than the one the row came from changes nothing.
    where e.event_at <= excluded.event_at;
    get diagnostics changed = row_count;
    outcome := case when changed = 0 then 'stale' else 'applied' end;
  end if;

  update public.billing_events b set result = outcome where b.webhook_id = apply_billing_event.webhook_id;
  return outcome;
end;
$$;

revoke execute on function public.apply_billing_event(
  text, text, timestamptz, uuid, text, text, text, timestamptz, boolean, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.apply_billing_event(
  text, text, timestamptz, uuid, text, text, text, timestamptz, boolean, boolean, text, text
) to service_role;

-- ── Reading one's plan on the website ────────────────────────────────────────────────────────────
-- The signed-in person's plan and whether sales are open, in the shape device_report answers them.
create function public.my_entitlement() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid := (select auth.uid());
begin
  if owner is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  perform public.require_second_factor();
  return jsonb_build_object('entitlement', public.entitlement_of(owner), 'billing_live', public.billing_live());
end;
$$;

revoke execute on function public.my_entitlement() from public, anon;
grant execute on function public.my_entitlement() to authenticated;

-- ── The extension learns its account's plan from its heartbeat ───────────────────────────────────
-- As in 20261120030000 (#250), and the answer also carries the plan of the device's own account and whether sales are
-- open (ADR-0042). The rest of the answer is unchanged.
create or replace function public.device_report(token text, version text, jobs jsonb default '[]'::jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.devices := public.device_for_token(token);
  job jsonb;
  latest text;
  security_fix boolean;
  stats boolean;
begin
  if jsonb_typeof(jobs) is distinct from 'array' or jsonb_array_length(jobs) > 50 then
    raise exception 'A report holds a list of at most 50 jobs.' using errcode = '22023', hint = 'bad_report';
  end if;
  update public.devices
  set last_seen_at = now(),
      extension_version = left(coalesce(nullif(device_report.version, ''), extension_version), 32)
  where id = dev.id;
  update public.device_tokens set last_used_at = now() where device_id = dev.id;
  for job in select value from jsonb_array_elements(jobs) loop
    insert into public.jobs as j (
      user_id, device_id, local_id, x_handle, kind, title, state, phase, state_reason,
      matched, done, skipped, failed, scanned, risk_level, started_at, finished_at
    ) values (
      dev.user_id, dev.id, job ->> 'local_id', job ->> 'x_handle', job ->> 'kind', job ->> 'title', job ->> 'state',
      -- The reason can quote X's notices, which never leave the browser (ADR-0004): it is never stored.
      coalesce(job ->> 'phase', ''), '',
      coalesce((job ->> 'matched')::integer, 0), coalesce((job ->> 'done')::integer, 0),
      coalesce((job ->> 'skipped')::integer, 0), coalesce((job ->> 'failed')::integer, 0),
      coalesce((job ->> 'scanned')::integer, 0), (job ->> 'risk_level')::smallint,
      (job ->> 'started_at')::timestamptz, (job ->> 'finished_at')::timestamptz
    )
    on conflict (device_id, local_id) do update set
      x_handle = excluded.x_handle, kind = excluded.kind, title = excluded.title, state = excluded.state,
      phase = excluded.phase, state_reason = excluded.state_reason, matched = excluded.matched,
      done = excluded.done, skipped = excluded.skipped, failed = excluded.failed, scanned = excluded.scanned,
      risk_level = excluded.risk_level, started_at = excluded.started_at, finished_at = excluded.finished_at;
  end loop;
  select r.version into latest
  from public.extension_releases r
  order by public.release_rank(r.version) desc
  limit 1;
  -- An unreadable reporting version counts as older than every release.
  select coalesce(bool_or(r.security), false) into security_fix
  from public.extension_releases r
  where public.release_rank(device_report.version) is null
     or public.release_rank(r.version) > public.release_rank(device_report.version);
  select coalesce((select c.enabled from public.daily_stats_choices c where c.user_id = dev.user_id), false)
    into stats;
  return jsonb_build_object(
    'latest', latest, 'security', security_fix, 'stats', stats,
    'entitlement', public.entitlement_of(dev.user_id), 'billing_live', public.billing_live());
end;
$$;
