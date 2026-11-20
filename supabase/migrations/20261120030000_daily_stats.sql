-- Daily numbers in the cloud, by the person's choice (#250, ADR-0026): one row of counts per X account per day,
-- never X content. The choice is one flag per account, so every connected browser follows it; turning it off deletes
-- every row already sent.

-- ── The person's choice ───────────────────────────────────────────────────────────────────────────
create table public.daily_stats_choices (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  changed_at timestamptz not null default now()
);

alter table public.daily_stats_choices enable row level security;

create policy "Owners read their choice" on public.daily_stats_choices
  for select to authenticated using ((select auth.uid()) = user_id);

-- ── The numbers: the columns ADR-0026 lists, and nothing else ─────────────────────────────────────
create table public.daily_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  day date not null,
  -- The profile as X last showed it that day; null when no profile was seen that day.
  followers integer check (followers between 0 and 1000000000),
  following integer check (following between 0 and 1000000000),
  posts_total integer check (posts_total between 0 and 1000000000),
  likes_total integer check (likes_total between 0 and 1000000000),
  -- Published that day, from the inventory.
  posted_posts integer not null default 0 check (posted_posts between 0 and 1000000000),
  posted_replies integer not null default 0 check (posted_replies between 0 and 1000000000),
  posted_reposts integer not null default 0 check (posted_reposts between 0 and 1000000000),
  posted_quotes integer not null default 0 check (posted_quotes between 0 and 1000000000),
  -- Received that day: increases seen in the counts of the person's own posts (an estimate).
  received_likes integer not null default 0 check (received_likes between 0 and 1000000000),
  received_replies integer not null default 0 check (received_replies between 0 and 1000000000),
  received_reposts integer not null default 0 check (received_reposts between 0 and 1000000000),
  received_quotes integer not null default 0 check (received_quotes between 0 and 1000000000),
  received_views integer not null default 0 check (received_views between 0 and 1000000000),
  observed_posts integer not null default 0 check (observed_posts between 0 and 1000000000),
  posts_with_likes integer not null default 0 check (posts_with_likes between 0 and 1000000000),
  replies_with_likes integer not null default 0 check (replies_with_likes between 0 and 1000000000),
  -- Removed by Xomoni that day.
  removed_posts integer not null default 0 check (removed_posts between 0 and 1000000000),
  removed_replies integer not null default 0 check (removed_replies between 0 and 1000000000),
  removed_reposts integer not null default 0 check (removed_reposts between 0 and 1000000000),
  removed_likes integer not null default 0 check (removed_likes between 0 and 1000000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, x_handle, day)
);

alter table public.daily_stats enable row level security;

create policy "Owners read their numbers" on public.daily_stats
  for select to authenticated using ((select auth.uid()) = user_id);

-- Read only: every write goes through the functions below.
grant select on public.daily_stats, public.daily_stats_choices to authenticated;

-- ── Writing the numbers: the extension, with its device token ─────────────────────────────────────
-- The columns a row may carry, as ADR-0026 lists them; the profile's four may be null.
create function public.daily_stats_columns() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'followers', 'following', 'posts_total', 'likes_total',
    'posted_posts', 'posted_replies', 'posted_reposts', 'posted_quotes',
    'received_likes', 'received_replies', 'received_reposts', 'received_quotes', 'received_views', 'observed_posts',
    'posts_with_likes', 'replies_with_likes',
    'removed_posts', 'removed_replies', 'removed_reposts', 'removed_likes'
  ]
$$;

revoke execute on function public.daily_stats_columns() from public, anon, authenticated;

-- Stores up to 60 days of numbers from a connected browser, only while its account has chosen to show them. Each
-- row has exactly `x_handle`, `day` and the columns above: a day in the last 400 days and not in the future, each
-- value a whole number from 0 to 10⁹ (the profile's may be null). Anything else refuses the whole call.
create function public.device_report_stats(token text, rows jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.devices := public.device_for_token(token);
  allowed text[] := array['x_handle', 'day'] || public.daily_stats_columns();
  r jsonb;
  k text;
  v jsonb;
  the_day date;
  stored integer := 0;
begin
  if not coalesce((select c.enabled from public.daily_stats_choices c where c.user_id = dev.user_id), false) then
    raise exception 'Daily numbers are off for this account.' using errcode = 'P0001', hint = 'stats_off';
  end if;
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) > 60 then
    raise exception 'A report holds a list of at most 60 days.' using errcode = '22023', hint = 'bad_report';
  end if;
  for r in select value from jsonb_array_elements(rows) loop
    if jsonb_typeof(r) is distinct from 'object' then
      raise exception 'Each day is an object.' using errcode = '22023', hint = 'bad_report';
    end if;
    for k, v in select key, value from jsonb_each(r) loop
      if not k = any(allowed) then
        raise exception 'A day carries only the daily numbers.' using errcode = '22023', hint = 'bad_report';
      end if;
      if k = any(public.daily_stats_columns()) and not (
        (jsonb_typeof(v) = 'null' and k in ('followers', 'following', 'posts_total', 'likes_total'))
        or (jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]{1,10}$' and (v #>> '{}')::bigint <= 1000000000)
      ) then
        raise exception 'Each value is a whole number from 0 to 10⁹.' using errcode = '22023', hint = 'bad_report';
      end if;
    end loop;
    if jsonb_typeof(r -> 'x_handle') is distinct from 'string' or (r ->> 'x_handle') !~ '^[A-Za-z0-9_]{1,15}$' then
      raise exception 'Each day names its X account.' using errcode = '22023', hint = 'bad_report';
    end if;
    if jsonb_typeof(r -> 'day') is distinct from 'string' or (r ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Each day is a date.' using errcode = '22023', hint = 'bad_report';
    end if;
    the_day := (r ->> 'day')::date;
    -- A browser's day may run a few hours ahead of the server's.
    if the_day > current_date + 1 or the_day < current_date - 400 then
      raise exception 'Days are from the last 400, none in the future.' using errcode = '22023', hint = 'bad_report';
    end if;
    insert into public.daily_stats as s (
      user_id, x_handle, day, followers, following, posts_total, likes_total,
      posted_posts, posted_replies, posted_reposts, posted_quotes,
      received_likes, received_replies, received_reposts, received_quotes, received_views, observed_posts,
      posts_with_likes, replies_with_likes, removed_posts, removed_replies, removed_reposts, removed_likes, updated_at
    ) values (
      dev.user_id, r ->> 'x_handle', the_day,
      (r ->> 'followers')::integer, (r ->> 'following')::integer,
      (r ->> 'posts_total')::integer, (r ->> 'likes_total')::integer,
      coalesce((r ->> 'posted_posts')::integer, 0), coalesce((r ->> 'posted_replies')::integer, 0),
      coalesce((r ->> 'posted_reposts')::integer, 0), coalesce((r ->> 'posted_quotes')::integer, 0),
      coalesce((r ->> 'received_likes')::integer, 0), coalesce((r ->> 'received_replies')::integer, 0),
      coalesce((r ->> 'received_reposts')::integer, 0), coalesce((r ->> 'received_quotes')::integer, 0),
      coalesce((r ->> 'received_views')::integer, 0), coalesce((r ->> 'observed_posts')::integer, 0),
      coalesce((r ->> 'posts_with_likes')::integer, 0), coalesce((r ->> 'replies_with_likes')::integer, 0),
      coalesce((r ->> 'removed_posts')::integer, 0), coalesce((r ->> 'removed_replies')::integer, 0),
      coalesce((r ->> 'removed_reposts')::integer, 0), coalesce((r ->> 'removed_likes')::integer, 0),
      now()
    )
    on conflict (user_id, x_handle, day) do update set
      followers = excluded.followers, following = excluded.following,
      posts_total = excluded.posts_total, likes_total = excluded.likes_total,
      posted_posts = excluded.posted_posts, posted_replies = excluded.posted_replies,
      posted_reposts = excluded.posted_reposts, posted_quotes = excluded.posted_quotes,
      received_likes = excluded.received_likes, received_replies = excluded.received_replies,
      received_reposts = excluded.received_reposts, received_quotes = excluded.received_quotes,
      received_views = excluded.received_views, observed_posts = excluded.observed_posts,
      posts_with_likes = excluded.posts_with_likes, replies_with_likes = excluded.replies_with_likes,
      removed_posts = excluded.removed_posts, removed_replies = excluded.removed_replies,
      removed_reposts = excluded.removed_reposts, removed_likes = excluded.removed_likes,
      updated_at = now();
    stored := stored + 1;
  end loop;
  return stored;
end;
$$;

-- ── The choice: on the website, or in the extension ──────────────────────────────────────────────
-- Records the choice for one account; turning it off deletes every row already sent.
create function public.choose_daily_stats(owner uuid, enabled boolean) returns boolean
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
  end if;
  return choose_daily_stats.enabled;
end;
$$;

revoke execute on function public.choose_daily_stats(uuid, boolean) from public, anon, authenticated;

-- The signed-in person's choice, from the website.
create function public.set_daily_stats(enabled boolean) returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.choose_daily_stats((select auth.uid()), set_daily_stats.enabled)
$$;

-- A connected browser's choice, from the extension, for the account it reports to.
create function public.device_set_daily_stats(token text, enabled boolean) returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.choose_daily_stats((public.device_for_token(token)).user_id, device_set_daily_stats.enabled)
$$;

revoke execute on function public.device_report_stats(text, jsonb) from public;
revoke execute on function public.set_daily_stats(boolean) from public, anon;
revoke execute on function public.device_set_daily_stats(text, boolean) from public;
grant execute on function public.device_report_stats(text, jsonb) to anon, authenticated;
grant execute on function public.device_set_daily_stats(text, boolean) to anon, authenticated;
grant execute on function public.set_daily_stats(boolean) to authenticated;

-- ── The extension learns the choice from its heartbeat ────────────────────────────────────────────
-- As before (#149, #151), and the answer also says whether the account shows its daily numbers.
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
  return jsonb_build_object('latest', latest, 'security', security_fix, 'stats', stats);
end;
$$;
