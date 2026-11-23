-- An email when X warns an account, only for those who ask (#407, ADR-0042): the person's choice and its stop token,
-- each X account's last level and the last rise it was told of, the alerts waiting to be sent, and the send by the
-- database's own scheduler through Resend, with the key in Vault, as the weekly email does (ADR-0031). The alert is
-- made of what the server already has: the account's handle and the risk level (0–4) each job report carries
-- (`public.jobs.risk_level`, ADR-0013). Nothing new leaves the browser, and the email asks for nothing: its only links
-- open the dashboard and stop the alert.

-- ── The person's choice ───────────────────────────────────────────────────────────────────────────
create table public.health_alerts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  -- Stops this person's alert from the link in it, without signing in. Never shown to the website.
  stop_token uuid not null unique default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  last_sent_at timestamptz
);

alter table public.health_alerts enable row level security;

create policy "Owners read their health alert" on public.health_alerts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Accounts with an authenticator app need aal2" on public.health_alerts
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

-- The website reads the choice and when one was last sent; the token stays in the database and the email.
grant select (user_id, enabled, changed_at, last_sent_at) on public.health_alerts to authenticated;
-- The admin role reads it, as for the weekly email, so the local stack's tests can follow a stop link.
grant select on public.health_alerts to service_role;

-- ── Each X account's level, and the alerts ────────────────────────────────────────────────────────
-- The level each account's newest report carried, and the highest level an alert was queued for and when: one alert per
-- rise, and none again for the same rise within a day (3 → 2 → 3).
create table public.health_alert_levels (
  user_id uuid not null references auth.users (id) on delete cascade,
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  level smallint not null check (level between 0 and 4),
  alerted_level smallint check (alerted_level between 2 and 4),
  alerted_at timestamptz,
  primary key (user_id, x_handle)
);

-- Alerts waiting for the next send, and those sent or dropped: the account and the level it rose to, nothing else.
create table public.health_alert_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  level smallint not null check (level between 2 and 4),
  risen_at timestamptz not null,
  sent_at timestamptz,
  dropped_at timestamptz
);

create index health_alert_queue_waiting_idx on public.health_alert_queue (user_id) where sent_at is null and dropped_at is null;

-- The database's own: no policy, so the website's roles read none of it.
alter table public.health_alert_levels enable row level security;
alter table public.health_alert_queue enable row level security;
grant select on public.health_alert_levels, public.health_alert_queue to service_role;

-- ── The choice, from the website ──────────────────────────────────────────────────────────────────
-- The signed-in person's choice. Taken while sending isn't set up too: it is kept, and the website says nothing is sent
-- until it is.
create function public.set_health_alert(enabled boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := (select auth.uid());
begin
  if owner is null then
    raise exception 'Sign in to choose the alert.' using errcode = 'P0001';
  end if;
  perform public.require_second_factor();
  insert into public.health_alerts as a (user_id, enabled, changed_at)
  values (owner, set_health_alert.enabled, now())
  on conflict (user_id) do update set enabled = excluded.enabled, changed_at = now();
  -- Turned off, nothing waiting is sent.
  if not set_health_alert.enabled then
    update public.health_alert_queue q set dropped_at = now()
    where q.user_id = owner and q.sent_at is null and q.dropped_at is null;
  end if;
  return set_health_alert.enabled;
end;
$$;

-- Whether the signed-in person gets the alert, and whether xomoni.com can send it at all (the Resend key is in Vault).
-- Says only that: never the key, nor anything about anyone else.
create function public.health_alert_status() returns table (enabled boolean, can_send boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid := (select auth.uid());
begin
  if owner is null then
    raise exception 'Sign in to see the alert.' using errcode = 'P0001';
  end if;
  perform public.require_second_factor();
  return query select
    coalesce((select a.enabled from public.health_alerts a where a.user_id = owner), false),
    exists (select 1 from vault.decrypted_secrets s where s.name = 'resend_api_key' and coalesce(s.decrypted_secret, '') <> '');
end;
$$;

-- Stops the alert whose link carries `token`, for anyone holding the link, and drops what waits. Always answers true,
-- so it says nothing about which tokens exist.
create function public.stop_health_alert(token uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  update public.health_alerts set enabled = false, changed_at = now()
  where stop_token = stop_health_alert.token and enabled
  returning user_id into owner;
  if owner is not null then
    update public.health_alert_queue q set dropped_at = now()
    where q.user_id = owner and q.sent_at is null and q.dropped_at is null;
  end if;
  return true;
end;
$$;

revoke execute on function public.set_health_alert(boolean) from public, anon;
revoke execute on function public.health_alert_status() from public, anon;
revoke execute on function public.stop_health_alert(uuid) from public;
grant execute on function public.set_health_alert(boolean) to authenticated;
grant execute on function public.health_alert_status() to authenticated;
grant execute on function public.stop_health_alert(uuid) to anon, authenticated;

-- ── A rise queues an alert ────────────────────────────────────────────────────────────────────────
-- After each job report: keeps the account's level, and queues an alert when it rose to Retreat (2) or above, unless
-- this rise was told already (the same level or less within a day) or the person didn't ask. Caution (1, one rate limit)
-- never does.
create function public.note_health_level() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.health_alert_levels;
  at_time timestamptz := now();
begin
  if new.risk_level is null then
    return null;
  end if;
  select * into previous from public.health_alert_levels l
  where l.user_id = new.user_id and l.x_handle = new.x_handle;
  insert into public.health_alert_levels as l (user_id, x_handle, level)
  values (new.user_id, new.x_handle, new.risk_level)
  on conflict (user_id, x_handle) do update set level = excluded.level;

  if new.risk_level < 2 or new.risk_level <= coalesce(previous.level, 0) then
    return null;
  end if;
  if previous.alerted_level is not null and new.risk_level <= previous.alerted_level
     and previous.alerted_at > at_time - interval '1 day' then
    return null;
  end if;
  if not exists (select 1 from public.health_alerts a where a.user_id = new.user_id and a.enabled) then
    return null;
  end if;
  insert into public.health_alert_queue (user_id, x_handle, level, risen_at)
  values (new.user_id, new.x_handle, new.risk_level, at_time);
  update public.health_alert_levels l set alerted_level = new.risk_level, alerted_at = at_time
  where l.user_id = new.user_id and l.x_handle = new.x_handle;
  return null;
end;
$$;

revoke execute on function public.note_health_level() from public, anon, authenticated;

create trigger jobs_note_health_level
  after insert or update of risk_level on public.jobs
  for each row execute function public.note_health_level();

-- ── The email's content ───────────────────────────────────────────────────────────────────────────
-- A time as the email writes it, in UTC, since the server doesn't know the person's time zone: "Nov 23, 14:05 UTC".
create function public.health_alert_time(at_time timestamptz) returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(at_time at time zone 'utc', 'FMMon FMDD, HH24:MI') || ' UTC'
$$;

-- What a level means, in the email's words, for an account that rose to it at `risen_at` (ADR-0013's ladder).
create function public.health_alert_line(handle text, level smallint, risen_at timestamptz) returns text
language sql
immutable
set search_path = ''
as $$
  select case level
    when 2 then 'X warned @' || handle || '. Xomoni stopped and won’t resume before '
      || public.health_alert_time(risen_at + interval '6 hours') || ', then goes at half its pace for a week.'
    when 3 then 'X warned @' || handle || ' again. Xomoni stopped and won’t resume before '
      || public.health_alert_time(risen_at + interval '12 hours') || ' at the earliest, then goes at a quarter of its pace.'
    else 'X warned @' || handle || ' in earnest. Xomoni stopped and won’t resume by itself: only you can, in Xomoni.'
  end
$$;

-- The email for `owner`'s alerts waiting to be sent: subject, text, HTML, and the addresses that stop it. Null when
-- none waits. The handles and fixed words only: nothing a person or X wrote.
create function public.health_alert_content(owner uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  token uuid;
  stop_page text;
  stop_now text;
  waiting record;
  handles text[] := '{}';
  lines text := '';
  items text := '';
begin
  for waiting in
    select distinct on (q.x_handle) q.x_handle, q.level, q.risen_at
    from public.health_alert_queue q
    where q.user_id = owner and q.sent_at is null and q.dropped_at is null
    order by q.x_handle, q.level desc, q.risen_at desc
  loop
    handles := handles || waiting.x_handle;
    lines := lines || public.health_alert_line(waiting.x_handle, waiting.level, waiting.risen_at) || E'\n';
    items := items || '<li style="margin:0 0 8px">'
      || public.health_alert_line(waiting.x_handle, waiting.level, waiting.risen_at) || '</li>';
  end loop;
  if cardinality(handles) = 0 then
    return null;
  end if;
  select a.stop_token into token from public.health_alerts a where a.user_id = owner;
  stop_page := 'https://xomoni.com/health-alert/stop?token=' || token;
  stop_now := 'https://xomoni.com/api/health-alert/stop?token=' || token;

  return jsonb_build_object(
    'subject', case when cardinality(handles) = 1 then 'X warned @' || handles[1]
                    else 'X warned ' || cardinality(handles) || ' of your X accounts' end,
    'text',
      lines
      || E'\nRest the account: don’t post, like or follow by hand until then. Open Xomoni to see why: '
      || E'https://xomoni.com/dashboard/health\n\n'
      || E'You get this email because you asked for it on xomoni.com. To stop it: ' || stop_page || E'\n',
    'html',
      '<div style="font-family:system-ui,sans-serif;color:#0b0b0b">'
      || '<ul style="padding-left:20px">' || items || '</ul>'
      || '<p>Rest the account: don’t post, like or follow by hand until then.</p>'
      || '<p><a href="https://xomoni.com/dashboard/health">Open Xomoni to see why</a></p>'
      || '<p style="color:#555;font-size:12px">You get this email because you asked for it on xomoni.com. '
      || '<a href="' || stop_page || '">Stop these alerts</a>.</p></div>',
    'stop_page', stop_page,
    'stop_now', stop_now
  );
end;
$$;

-- ── Sending ───────────────────────────────────────────────────────────────────────────────────────
-- Drops what no longer needs telling (the person turned it off, the account rested back below Retreat, or the alert
-- waited a day), then sends each person with alerts waiting one email through Resend, at most one in six hours. The
-- Resend key comes from Vault; without it nothing is sent. Returns how many were handed to Resend; pg_net sends them
-- once this transaction commits. Only the database's owner runs it (the scheduler).
create function public.send_health_alerts(at_time timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  person record;
  content jsonb;
  sent integer := 0;
begin
  update public.health_alert_queue q set dropped_at = at_time
  where q.sent_at is null and q.dropped_at is null
    and (
      q.risen_at < at_time - interval '1 day'
      or not exists (select 1 from public.health_alerts a where a.user_id = q.user_id and a.enabled)
      or coalesce((select l.level from public.health_alert_levels l
                   where l.user_id = q.user_id and l.x_handle = q.x_handle), 0) < 2
    );

  select s.decrypted_secret into api_key from vault.decrypted_secrets s where s.name = 'resend_api_key';
  if coalesce(api_key, '') = '' then
    return 0;
  end if;
  for person in
    select a.user_id, u.email
    from public.health_alerts a
    join auth.users u on u.id = a.user_id
    where a.enabled and coalesce(u.email, '') <> ''
      and (a.last_sent_at is null or a.last_sent_at <= at_time - interval '6 hours')
      and exists (select 1 from public.health_alert_queue q
                  where q.user_id = a.user_id and q.sent_at is null and q.dropped_at is null)
  loop
    content := public.health_alert_content(person.user_id);
    continue when content is null;
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
      body := jsonb_build_object(
        'from', 'Xomoni <no-reply@xomoni.com>',
        'to', jsonb_build_array(person.email),
        'subject', content ->> 'subject',
        'text', content ->> 'text',
        'html', content ->> 'html',
        'headers', jsonb_build_object(
          'List-Unsubscribe', '<' || (content ->> 'stop_now') || '>',
          'List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'
        )
      ),
      timeout_milliseconds := 10000
    );
    update public.health_alert_queue q set sent_at = at_time
    where q.user_id = person.user_id and q.sent_at is null and q.dropped_at is null;
    update public.health_alerts a set last_sent_at = at_time where a.user_id = person.user_id;
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke execute on function public.health_alert_time(timestamptz) from public, anon, authenticated;
revoke execute on function public.health_alert_line(text, smallint, timestamptz) from public, anon, authenticated;
revoke execute on function public.health_alert_content(uuid) from public, anon, authenticated;
revoke execute on function public.send_health_alerts(timestamptz) from public, anon, authenticated;
-- The admin role runs them, as for reading the weekly email's choice, so the local stack's tests can see the email that
-- would go and run a send without a key. The apps never hold this key (SECURITY.md).
grant execute on function public.health_alert_time(timestamptz) to service_role;
grant execute on function public.health_alert_line(text, smallint, timestamptz) to service_role;
grant execute on function public.health_alert_content(uuid) to service_role;
grant execute on function public.send_health_alerts(timestamptz) to service_role;

-- Every five minutes: an alert reaches the person a few minutes after Xomoni reported the rise.
select cron.schedule('health-alert', '*/5 * * * *', $$ select public.send_health_alerts() $$);
