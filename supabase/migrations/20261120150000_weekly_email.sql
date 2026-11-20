-- A weekly email of the daily numbers, only for those who ask (#257, ADR-0031): the person's choice and their stop
-- token, the email's content (counts only), and the weekly send by the database's own scheduler through Resend, whose
-- key lives in Vault. Without that key nothing is sent.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
create extension if not exists pg_net;

-- ── The person's choice ───────────────────────────────────────────────────────────────────────────
create table public.weekly_emails (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  -- Stops this person's email from the link in it, without signing in. Never shown to the website.
  stop_token uuid not null unique default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  last_sent_at timestamptz
);

alter table public.weekly_emails enable row level security;

create policy "Owners read their weekly email" on public.weekly_emails
  for select to authenticated using ((select auth.uid()) = user_id);

-- The website reads the choice and when one was last sent; the token stays in the database and the email.
grant select (user_id, enabled, changed_at, last_sent_at) on public.weekly_emails to authenticated;
-- The admin role reads it, as for the daily numbers, so the local stack's tests can follow a stop link (#252's grant).
-- The apps never hold this key (SECURITY.md).
grant select on public.weekly_emails to service_role;

-- The signed-in person's choice. Only while their daily numbers are on: the email is made of them.
create function public.set_weekly_email(enabled boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := (select auth.uid());
begin
  if owner is null then
    raise exception 'Sign in to choose the weekly email.' using errcode = 'P0001';
  end if;
  if set_weekly_email.enabled
     and not exists (select 1 from public.daily_stats_choices c where c.user_id = owner and c.enabled) then
    raise exception 'Turn on your daily numbers first.' using errcode = 'P0001';
  end if;
  insert into public.weekly_emails as w (user_id, enabled, changed_at)
  values (owner, set_weekly_email.enabled, now())
  on conflict (user_id) do update set enabled = excluded.enabled, changed_at = now();
  return set_weekly_email.enabled;
end;
$$;

-- Stops the email whose link carries `token`, for anyone holding the link. Always answers true, so it says nothing
-- about which tokens exist.
create function public.stop_weekly_email(token uuid) returns boolean
language sql
security definer
set search_path = ''
as $$
  with stopped as (
    update public.weekly_emails set enabled = false, changed_at = now()
    where stop_token = stop_weekly_email.token and enabled
    returning 1
  )
  select true
$$;

revoke execute on function public.set_weekly_email(boolean) from public, anon;
revoke execute on function public.stop_weekly_email(uuid) from public;
grant execute on function public.set_weekly_email(boolean) to authenticated;
grant execute on function public.stop_weekly_email(uuid) to anon, authenticated;

-- Turning the daily numbers off now also turns the weekly email off: it has nothing to say without them.
create or replace function public.choose_daily_stats(owner uuid, enabled boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_stats_choices as c (user_id, enabled, changed_at)
  values (owner, choose_daily_stats.enabled, now())
  on conflict (user_id) do update set enabled = excluded.enabled, changed_at = now();
  if not choose_daily_stats.enabled then
    delete from public.daily_stats where user_id = owner;
    update public.weekly_emails w set enabled = false, changed_at = now() where w.user_id = owner and w.enabled;
  end if;
  return choose_daily_stats.enabled;
end;
$$;

revoke execute on function public.choose_daily_stats(uuid, boolean) from public, anon, authenticated;

-- ── The email's content ───────────────────────────────────────────────────────────────────────────
-- A person's totals over some days, every X account together. Followers: each account's latest count, added up.
create function public.weekly_numbers(owner uuid, first_day date, last_day date)
returns table (
  followers bigint,
  posts bigint,
  replies bigint,
  likes_received bigint,
  replies_received bigint,
  views bigint,
  removed bigint,
  days bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (select sum(latest.followers)::bigint from (
       select distinct on (s.x_handle) s.followers
       from public.daily_stats s
       where s.user_id = owner and s.day between first_day and last_day and s.followers is not null
       order by s.x_handle, s.day desc
     ) latest),
    sum(s.posted_posts)::bigint,
    sum(s.posted_replies)::bigint,
    sum(s.received_likes)::bigint,
    sum(s.received_replies)::bigint,
    sum(s.received_views)::bigint,
    sum(s.removed_posts + s.removed_replies + s.removed_reposts + s.removed_likes)::bigint,
    count(*)
  from public.daily_stats s
  where s.user_id = owner and s.day between first_day and last_day
$$;

-- A whole number as people read it: 1,234.
create function public.weekly_count(n bigint) returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(n, 'FM999,999,999,999,990')
$$;

-- How a number moved against the week before, in words: " (+20 from the week before)", or nothing.
create function public.weekly_change(value bigint, previous bigint) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when value is null or previous is null or value = previous then ''
    when value > previous then ' (+' || public.weekly_count(value - previous) || ' from the week before)'
    else ' (−' || public.weekly_count(previous - value) || ' from the week before)'
  end
$$;

-- The email for `owner` covering the seven days that end on `last_day`: subject, text, HTML, and the addresses that
-- stop it. Null for a week without numbers. Numbers and fixed words only: nothing a person or X wrote.
create function public.weekly_email_content(owner uuid, last_day date) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  this record;
  before record;
  token uuid;
  stop_page text;
  stop_now text;
  period text;
  lines text := '';
  rows text := '';
  line record;
begin
  select * into this from public.weekly_numbers(owner, last_day - 6, last_day);
  if this.days = 0 then
    return null;
  end if;
  select * into before from public.weekly_numbers(owner, last_day - 13, last_day - 7);
  select w.stop_token into token from public.weekly_emails w where w.user_id = owner;
  stop_page := 'https://xomoni.com/weekly-email/stop?token=' || token;
  stop_now := 'https://xomoni.com/api/weekly-email/stop?token=' || token;
  period := to_char(last_day - 6, 'FMMon FMDD') || ' to ' || to_char(last_day, 'FMMon FMDD, YYYY');

  for line in
    select t.label, t.value, t.previous
    from (values
      (1, 'Followers', this.followers, before.followers),
      (2, 'Posts published', this.posts, before.posts),
      (3, 'Replies published', this.replies, before.replies),
      (4, 'Likes received *', this.likes_received, before.likes_received),
      (5, 'Replies received *', this.replies_received, before.replies_received),
      (6, 'Views *', this.views, before.views),
      (7, 'Removed by Xomoni', this.removed, before.removed)
    ) as t(n, label, value, previous)
    where t.value is not null
    order by t.n
  loop
    lines := lines || line.label || ': ' || public.weekly_count(line.value)
      || public.weekly_change(line.value, line.previous) || E'\n';
    rows := rows || '<tr><td style="padding:4px 16px 4px 0">' || line.label || '</td>'
      || '<td style="padding:4px 0;text-align:right"><strong>' || public.weekly_count(line.value) || '</strong>'
      || public.weekly_change(line.value, line.previous) || '</td></tr>';
  end loop;

  return jsonb_build_object(
    'subject', 'Your week on X: ' || period,
    'text',
      'Your week on X, ' || period || E', all your accounts together:\n\n' || lines
      || E'\n* Estimates, from the posts Xomoni saw.\n\n'
      || E'Your reports: https://xomoni.com/dashboard/reports\n\n'
      || E'You get this email because you asked for it on xomoni.com. To stop it: ' || stop_page || E'\n',
    'html',
      '<div style="font-family:system-ui,sans-serif;color:#0b0b0b">'
      || '<p>Your week on X, ' || period || ', all your accounts together:</p>'
      || '<table style="border-collapse:collapse">' || rows || '</table>'
      || '<p style="color:#555">* Estimates, from the posts Xomoni saw.</p>'
      || '<p><a href="https://xomoni.com/dashboard/reports">Your reports on xomoni.com</a></p>'
      || '<p style="color:#555;font-size:12px">You get this email because you asked for it on xomoni.com. '
      || '<a href="' || stop_page || '">Stop the weekly email</a>.</p></div>',
    'stop_page', stop_page,
    'stop_now', stop_now
  );
end;
$$;

-- ── Sending, once a week ──────────────────────────────────────────────────────────────────────────
-- Sends each person who asked, whose numbers are on and who has numbers for the week, one email through Resend, at
-- most once in six days. The Resend key comes from Vault; without it nothing is sent. Returns how many were handed
-- to Resend; pg_net sends them once this transaction commits. Only the database's owner runs it (the scheduler).
create function public.send_weekly_emails(at_time timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  person record;
  content jsonb;
  last_day date := (at_time at time zone 'utc')::date - 1;
  sent integer := 0;
begin
  select s.decrypted_secret into api_key from vault.decrypted_secrets s where s.name = 'resend_api_key';
  if coalesce(api_key, '') = '' then
    return 0;
  end if;
  for person in
    select w.user_id, u.email
    from public.weekly_emails w
    join public.daily_stats_choices c on c.user_id = w.user_id and c.enabled
    join auth.users u on u.id = w.user_id
    where w.enabled and coalesce(u.email, '') <> ''
      and (w.last_sent_at is null or w.last_sent_at < at_time - interval '6 days')
  loop
    content := public.weekly_email_content(person.user_id, last_day);
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
    update public.weekly_emails set last_sent_at = at_time where user_id = person.user_id;
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke execute on function public.weekly_numbers(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.weekly_count(bigint) from public, anon, authenticated;
revoke execute on function public.weekly_change(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.weekly_email_content(uuid, date) from public, anon, authenticated;
revoke execute on function public.send_weekly_emails(timestamptz) from public, anon, authenticated;

-- Mondays at 07:00 UTC, for the seven days before.
select cron.schedule('weekly-email', '0 7 * * 1', $$ select public.send_weekly_emails() $$);
