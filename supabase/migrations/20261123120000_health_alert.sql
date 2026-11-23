-- An email when X warns an account, only for those who ask (#407, ADR-0047): the person's choice and its stop token;
-- for those who asked only, each X account's level and the last rise they were told of, and the alerts waiting to be
-- sent; and the send by the database's own scheduler through Resend, with the key in Vault, as the weekly email does
-- (ADR-0031). The alert is made of what the server already has: the account's handle and the risk level (0–4) each job
-- report carries (`public.jobs.risk_level`, ADR-0013). Nothing new leaves the browser, and the email asks for nothing:
-- its only links open the dashboard and stop the alert. What it keeps goes away on its own: the levels with the
-- choice or the account's last job, and each alert a week after it was sent or dropped.

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
-- Only for people who asked: each X account's level, the highest its jobs reported in the last day, and the highest
-- level an email told and when, so a rise is told once, and not again for the same rise within a day (3 → 2 → 3).
-- Deleted when the person turns the alert off, and once the account has no job left.
create table public.health_alert_levels (
  user_id uuid not null references auth.users (id) on delete cascade,
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  level smallint not null check (level between 0 and 4),
  alerted_level smallint check (alerted_level between 2 and 4),
  alerted_at timestamptz,
  primary key (user_id, x_handle)
);

-- Alerts waiting for the next send, and those sent or dropped, for a week: the account and the level it rose to, and
-- the `pg_net` request that sent it, to find a failed send in `net._http_response`.
create table public.health_alert_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  level smallint not null check (level between 2 and 4),
  risen_at timestamptz not null,
  sent_at timestamptz,
  dropped_at timestamptz,
  request_id bigint
);

create index health_alert_queue_waiting_idx on public.health_alert_queue (user_id) where sent_at is null and dropped_at is null;

-- The database's own: no policy, so the website's roles read none of it.
alter table public.health_alert_levels enable row level security;
alter table public.health_alert_queue enable row level security;
grant select on public.health_alert_levels, public.health_alert_queue to service_role;

-- ── The choice, from the website ──────────────────────────────────────────────────────────────────
-- Forgets what was kept for `owner`'s alerts once they turn them off: what waits is dropped, and the levels go.
create function public.forget_health_alert(owner uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.health_alert_queue q set dropped_at = now()
  where q.user_id = owner and q.sent_at is null and q.dropped_at is null;
  delete from public.health_alert_levels l where l.user_id = owner;
$$;

revoke execute on function public.forget_health_alert(uuid) from public, anon, authenticated;

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
  -- Turned off: nothing waiting is sent, and the levels kept for it go.
  if not set_health_alert.enabled then
    perform public.forget_health_alert(owner);
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

-- Stops the alert whose link carries `token`, for anyone holding the link, and forgets what was kept for it. Always
-- answers true, so it says nothing about which tokens exist.
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
    perform public.forget_health_alert(owner);
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
-- An X account's level at `at_time`: the highest its jobs reported in the day before. Two browsers on one account may
-- report different levels; the higher one counts, so a rest one browser reports isn't undone by the other. Null when
-- no job of it reported a level that day.
create function public.health_account_level(owner uuid, handle text, at_time timestamptz) returns smallint
language sql
stable
set search_path = ''
as $$
  select max(j.risk_level) from public.jobs j
  where j.user_id = owner and j.x_handle = handle and j.risk_level is not null
    and j.updated_at > at_time - interval '1 day'
$$;

-- After each job report of someone who asked: keeps the account's level, and queues an alert when it rose to Retreat
-- (2) or above, unless that rise was told already (an email for the same level or higher within a day) or waits to
-- be. Caution (1, one rate limit) never does. Nothing is kept for someone who didn't ask.
create function public.note_health_level() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.health_alert_levels;
  current smallint;
  at_time timestamptz := now();
begin
  if new.risk_level is null
     or not exists (select 1 from public.health_alerts a where a.user_id = new.user_id and a.enabled) then
    return null;
  end if;
  current := coalesce(public.health_account_level(new.user_id, new.x_handle, at_time), new.risk_level);
  select * into previous from public.health_alert_levels l
  where l.user_id = new.user_id and l.x_handle = new.x_handle;
  insert into public.health_alert_levels as l (user_id, x_handle, level)
  values (new.user_id, new.x_handle, current)
  on conflict (user_id, x_handle) do update set level = excluded.level;

  if current < 2 or current <= coalesce(previous.level, 0) then
    return null;
  end if;
  if previous.alerted_level is not null and current <= previous.alerted_level
     and previous.alerted_at > at_time - interval '1 day' then
    return null;
  end if;
  if exists (select 1 from public.health_alert_queue q
             where q.user_id = new.user_id and q.x_handle = new.x_handle and q.level >= current
               and q.sent_at is null and q.dropped_at is null) then
    return null;
  end if;
  insert into public.health_alert_queue (user_id, x_handle, level, risen_at)
  values (new.user_id, new.x_handle, current, at_time);
  return null;
end;
$$;

revoke execute on function public.health_account_level(uuid, text, timestamptz) from public, anon, authenticated;
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

-- The most accounts an email names; the rest are counted.
create function public.health_alert_most() returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;

-- The email for `alerts` (`[{x_handle, level, risen_at}]`), or, without them, for `owner`'s alerts waiting to be sent:
-- subject, text, HTML, and the addresses that stop it. Each account once, at its highest level, the highest first, at
-- most ten, then how many more. Null when there is none. The handles and fixed words only: nothing a person or X wrote.
create function public.health_alert_content(owner uuid, alerts jsonb default null) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  token uuid;
  stop_page text;
  stop_now text;
  told record;
  accounts integer := 0;
  first_handle text;
  lines text := '';
  items text := '';
begin
  for told in
    with given as (
      select a.x_handle, a.level, a.risen_at
      from jsonb_to_recordset(alerts) as a (x_handle text, level smallint, risen_at timestamptz)
      where alerts is not null
      union all
      select q.x_handle, q.level, q.risen_at
      from public.health_alert_queue q
      where alerts is null and q.user_id = owner and q.sent_at is null and q.dropped_at is null
    ),
    each_account as (
      select distinct on (g.x_handle) g.x_handle, g.level, g.risen_at
      from given g
      order by g.x_handle, g.level desc, g.risen_at desc
    )
    select e.x_handle, e.level, e.risen_at from each_account e order by e.level desc, e.x_handle
  loop
    accounts := accounts + 1;
    if accounts = 1 then
      first_handle := told.x_handle;
    end if;
    continue when accounts > public.health_alert_most();
    lines := lines || public.health_alert_line(told.x_handle, told.level, told.risen_at) || E'\n';
    items := items || '<li style="margin:0 0 8px">'
      || public.health_alert_line(told.x_handle, told.level, told.risen_at) || '</li>';
  end loop;
  if accounts = 0 then
    return null;
  end if;
  if accounts > public.health_alert_most() then
    lines := lines || 'And ' || (accounts - public.health_alert_most()) || E' more of your X accounts: see them in Xomoni.\n';
    items := items || '<li style="margin:0 0 8px">And ' || (accounts - public.health_alert_most())
      || ' more of your X accounts: see them in Xomoni.</li>';
  end if;
  select a.stop_token into token from public.health_alerts a where a.user_id = owner;
  stop_page := 'https://xomoni.com/health-alert/stop?token=' || token;
  stop_now := 'https://xomoni.com/api/health-alert/stop?token=' || token;

  return jsonb_build_object(
    'subject', case when accounts = 1 then 'X warned @' || first_handle
                    else 'X warned ' || accounts || ' of your X accounts' end,
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
-- First what goes away on its own: an alert a week after it was sent or dropped, and the levels of an account with no
-- job left. Then drops what no longer needs telling: the person turned it off, the account rested back below Retreat
-- (its highest level in the last day), or the alert waited a day. Then, for each person with alerts waiting, at most
-- one email in six hours: it claims their waiting alerts, so a run at the same time or an alert queued meanwhile can't
-- be sent twice or marked sent unsent, builds the email from those alone, and hands it to Resend, keeping the request's
-- id. The Resend key comes from Vault; without it nothing is sent. Returns how many emails were handed to Resend;
-- pg_net sends them once this transaction commits. Only the database's owner runs it (the scheduler).
create function public.send_health_alerts(at_time timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  person record;
  claimed_ids bigint[];
  claimed jsonb;
  content jsonb;
  request bigint;
  sent integer := 0;
begin
  delete from public.health_alert_queue q where coalesce(q.sent_at, q.dropped_at) < at_time - interval '7 days';
  delete from public.health_alert_levels l
  where not exists (select 1 from public.jobs j where j.user_id = l.user_id and j.x_handle = l.x_handle);
  update public.health_alert_queue q set dropped_at = at_time
  where q.sent_at is null and q.dropped_at is null
    and (
      q.risen_at < at_time - interval '1 day'
      or not exists (select 1 from public.health_alerts a where a.user_id = q.user_id and a.enabled)
      or coalesce(public.health_account_level(q.user_id, q.x_handle, at_time), 0) < 2
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
    for update of a skip locked
  loop
    with claim as (
      update public.health_alert_queue q set sent_at = at_time
      where q.user_id = person.user_id and q.sent_at is null and q.dropped_at is null
      returning q.id, q.x_handle, q.level, q.risen_at
    )
    select array_agg(c.id), jsonb_agg(jsonb_build_object('x_handle', c.x_handle, 'level', c.level, 'risen_at', c.risen_at))
    into claimed_ids, claimed
    from claim c;
    continue when claimed_ids is null;
    content := public.health_alert_content(person.user_id, claimed);
    select net.http_post(
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
    ) into request;
    update public.health_alert_queue q set request_id = request where q.id = any (claimed_ids);
    -- Told now: each account's highest level in this email, so the same rise isn't told again within a day.
    update public.health_alert_levels l set alerted_level = t.level, alerted_at = at_time
    from (
      select a.x_handle, max(a.level) as level
      from jsonb_to_recordset(claimed) as a (x_handle text, level smallint)
      group by a.x_handle
    ) t
    where l.user_id = person.user_id and l.x_handle = t.x_handle;
    update public.health_alerts a set last_sent_at = at_time where a.user_id = person.user_id;
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke execute on function public.health_alert_time(timestamptz) from public, anon, authenticated;
revoke execute on function public.health_alert_line(text, smallint, timestamptz) from public, anon, authenticated;
revoke execute on function public.health_alert_most() from public, anon, authenticated;
revoke execute on function public.health_alert_content(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.send_health_alerts(timestamptz) from public, anon, authenticated;
-- The admin role runs them, as for reading the weekly email's choice, so the local stack's tests can see the email that
-- would go and run a send without a key. The apps never hold this key (SECURITY.md).
grant execute on function public.health_alert_time(timestamptz) to service_role;
grant execute on function public.health_alert_line(text, smallint, timestamptz) to service_role;
grant execute on function public.health_alert_most() to service_role;
grant execute on function public.health_account_level(uuid, text, timestamptz) to service_role;
grant execute on function public.health_alert_content(uuid, jsonb) to service_role;
grant execute on function public.send_health_alerts(timestamptz) to service_role;

-- Every five minutes: an alert reaches the person a few minutes after Xomoni reported the rise.
select cron.schedule('health-alert', '*/5 * * * *', $$ select public.send_health_alerts() $$);
