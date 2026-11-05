-- Database hardening (#149): nothing reaches the Data API roles unless granted by name, a job's reason never
-- reaches the cloud, and a device token stops working after 90 days without a report.

-- ── Nothing new in public is exposed by itself ────────────────────────────────────────────────────
-- Supabase grants every new table, sequence and function in public to anon and authenticated by default
-- (`auto_expose_new_tables`). From here on each one is granted by name, in the migration that creates it.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- PUBLIC's EXECUTE on new functions is a global default, which a per-schema setting can't take away.
alter default privileges for role postgres revoke execute on functions from public;

-- The one function that kept PUBLIC's EXECUTE: a trigger function, which runs without it.
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- The two tables the website reads relied on those defaults. They get exactly what the website and their
-- policies use, by name: no TRUNCATE (which Row Level Security doesn't cover), REFERENCES or TRIGGER.
revoke all on public.devices, public.jobs from anon, authenticated;
grant select, insert, update, delete on public.devices, public.jobs to authenticated;

-- ── A job's reason stays in the browser (ADR-0004) ────────────────────────────────────────────────
update public.jobs set state_reason = '' where state_reason <> '';
alter table public.jobs add constraint jobs_state_reason_empty check (state_reason = '');

-- ── Device tokens expire after 90 days without a report ───────────────────────────────────────────
alter table public.device_tokens add column last_used_at timestamptz not null default now();

-- As before, and a token unused for 90 days is unknown: the extension says to connect again.
create or replace function public.device_for_token(token text) returns public.devices
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_device public.devices;
begin
  select d.* into found_device
  from public.devices d
  join public.device_tokens t on t.device_id = d.id
  where t.token_hash = extensions.digest(coalesce(token, ''), 'sha256')
    and t.last_used_at > now() - interval '90 days';
  if found_device.id is null then
    raise exception 'This browser is not connected to a Xomoni account.' using errcode = 'P0001', hint = 'unknown_device';
  end if;
  return found_device;
end;
$$;

-- As before, and each report keeps its token alive; the reason is never stored.
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
  return jsonb_build_object('latest', latest, 'security', security_fix);
end;
$$;
