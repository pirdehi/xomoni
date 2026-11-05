-- A connected browser hears about a new version of the extension (#151) in the answer to its status report,
-- until the Chrome Web Store ships updates (#43). The maintainer records each release here with a migration
-- (docs/RELEASING.md); nobody reads the table directly.
create table public.extension_releases (
  version text primary key check (version ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'),
  published_at timestamptz not null default now(),
  -- The release fixes a vulnerability: the extension says so, and the notice can't be dismissed.
  security boolean not null default false
);
alter table public.extension_releases enable row level security;
revoke all on public.extension_releases from public, anon, authenticated;

insert into public.extension_releases (version, published_at) values ('0.1.0', '2026-10-30T00:00:00Z');

-- A version as numbers, so 0.10.0 sorts after 0.9.0; null for anything else.
create function public.release_rank(version text) returns integer[]
language sql
immutable
set search_path = ''
as $$
  select case when version ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$' then string_to_array(version, '.')::integer[] end;
$$;

-- device_report now answers with the newest release and whether any release newer than the reporting version
-- fixes a vulnerability. Its parameters and its checks are unchanged; only the return type is new, so it is
-- dropped and created again, with its grants.
drop function public.device_report(text, text, jsonb);

create function public.device_report(token text, version text, jobs jsonb default '[]'::jsonb) returns jsonb
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
  for job in select value from jsonb_array_elements(jobs) loop
    insert into public.jobs as j (
      user_id, device_id, local_id, x_handle, kind, title, state, phase, state_reason,
      matched, done, skipped, failed, scanned, risk_level, started_at, finished_at
    ) values (
      dev.user_id, dev.id, job ->> 'local_id', job ->> 'x_handle', job ->> 'kind', job ->> 'title', job ->> 'state',
      coalesce(job ->> 'phase', ''), coalesce(job ->> 'state_reason', ''),
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

revoke execute on function public.release_rank(text), public.device_report(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.device_report(text, text, jsonb) to anon, authenticated;
