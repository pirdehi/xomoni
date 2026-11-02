-- Pairing the extension with an account, and the status it reports (#38, #39, #40; ADR-0018).
--
-- The extension never holds a user session. The person, signed in on xomoni.com, asks for a one-time code
-- and types it into the extension. The extension trades the code for a device token that can do exactly
-- three things, all through the functions below: report its jobs' status, say it is still there, and
-- disconnect itself. It cannot read anything, see other devices, or change the account.
--
-- * device_pairings: one short-lived code per user, stored only as a SHA-256 hash.
-- * device_tokens: one token per device, stored only as a SHA-256 hash.
-- Both tables have Row Level Security on and no policies: only these security-definer functions touch them.
-- Nothing here stores X content; the job fields are the counters and states the dashboard already shows.

create table public.device_pairings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash bytea not null unique,
  expires_at timestamptz not null
);

create table public.device_tokens (
  device_id uuid primary key references public.devices (id) on delete cascade,
  token_hash bytea not null unique
);

alter table public.device_pairings enable row level security;
alter table public.device_tokens enable row level security;
revoke all on public.device_pairings, public.device_tokens from anon, authenticated;

-- Codes are 10 characters from Crockford's base-32 alphabet (no I, L, O or U): 50 bits, valid 10 minutes,
-- usable once. Typed with or without the dash and in any case.
create function public.normalize_pairing_code(code text) returns text
language sql
immutable
set search_path = ''
as $$
  select translate(upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g')), 'ILO', '110');
$$;

-- For the signed-in person on the website: a new code, replacing any earlier one. Returns the code once.
create function public.create_pairing_code() returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(10);
  raw text := '';
  until timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  for i in 0..9 loop
    raw := raw || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.device_pairings (user_id, code_hash, expires_at)
  values (auth.uid(), extensions.digest(raw, 'sha256'), until)
  on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
  return query select substr(raw, 1, 5) || '-' || substr(raw, 6, 5), until;
end;
$$;

-- For the extension: trades a code for a device and its token. A code that works is used up. When it doesn't
-- (wrong, expired, or the account already has its 10 devices, #82), nothing changes.
create function public.pair_device(code text, name text, version text)
returns table (device_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  fresh boolean;
  new_device uuid;
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.device_pairings p
  where p.code_hash = extensions.digest(public.normalize_pairing_code(code), 'sha256')
  returning p.user_id, p.expires_at > now() into owner, fresh;
  if owner is null or not fresh then
    raise exception 'This code is not valid. Get a new one on xomoni.com.' using errcode = 'P0001', hint = 'bad_code';
  end if;
  insert into public.devices (user_id, name, extension_version)
  values (owner, left(coalesce(nullif(trim(name), ''), 'Browser'), 80), left(coalesce(nullif(version, ''), '0'), 32))
  returning id into new_device;
  insert into public.device_tokens (device_id, token_hash) values (new_device, extensions.digest(secret, 'sha256'));
  return query select new_device, secret;
end;
$$;

-- The device a token belongs to, or an error the extension reads as "disconnected" (hint `unknown_device`).
create function public.device_for_token(token text) returns public.devices
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
  where t.token_hash = extensions.digest(coalesce(token, ''), 'sha256');
  if found_device.id is null then
    raise exception 'This browser is not connected to a Xomoni account.' using errcode = 'P0001', hint = 'unknown_device';
  end if;
  return found_device;
end;
$$;

-- For the extension: says it is still there (#39) and reports its jobs' status (#40), at most 50 at a time.
-- Each job is matched by the extension's own id, so a report updates the row it created before.
create function public.device_report(token text, version text, jobs jsonb default '[]'::jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.devices := public.device_for_token(token);
  job jsonb;
begin
  if jsonb_typeof(jobs) is distinct from 'array' or jsonb_array_length(jobs) > 50 then
    raise exception 'A report holds a list of at most 50 jobs.' using errcode = '22023', hint = 'bad_report';
  end if;
  update public.devices
  set last_seen_at = now(), extension_version = left(coalesce(nullif(version, ''), extension_version), 32)
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
end;
$$;

-- For the extension: disconnects itself. Its jobs go with it. Unknown tokens are ignored.
create function public.unpair_device(token text) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.devices d
  using public.device_tokens t
  where t.device_id = d.id and t.token_hash = extensions.digest(coalesce(token, ''), 'sha256');
$$;

-- Only what each caller needs: the website's signed-in person creates codes; the extension, holding no session,
-- pairs, reports and disconnects with its token.
revoke execute on function
  public.normalize_pairing_code(text), public.create_pairing_code(), public.pair_device(text, text, text),
  public.device_for_token(text), public.device_report(text, text, jsonb), public.unpair_device(text)
from public, anon, authenticated;
grant execute on function public.create_pairing_code() to authenticated;
grant execute on function public.pair_device(text, text, text), public.device_report(text, text, jsonb),
  public.unpair_device(text) to anon, authenticated;
