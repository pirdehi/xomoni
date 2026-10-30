-- Xomoni cloud schema.
--
-- The cloud only knows what the website needs to show status: which browsers
-- have the extension signed in, and a summary of each job (counts and state).
-- Post text, likes, the inventory and the activity log never leave the
-- extension, and the website cannot start a deletion.

-- Browsers where the Xomoni extension is signed in.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  extension_version text not null check (char_length(extension_version) between 1 and 32),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index devices_user_id_idx on public.devices (user_id);

-- One row per extension job, mirroring its state and counters.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  local_id text not null check (char_length(local_id) between 1 and 64),
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  kind text not null check (kind in ('cleanup', 'scan')),
  title text not null check (char_length(title) between 1 and 200),
  state text not null check (state in ('queued', 'running', 'waiting', 'paused', 'blocked', 'completed', 'cancelled', 'failed')),
  phase text not null default '' check (char_length(phase) <= 200),
  state_reason text not null default '' check (char_length(state_reason) <= 500),
  matched integer not null default 0 check (matched >= 0),
  done integer not null default 0 check (done >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  failed integer not null default 0 check (failed >= 0),
  scanned integer not null default 0 check (scanned >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, local_id)
);

create index jobs_user_id_updated_at_idx on public.jobs (user_id, updated_at desc);

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function public.touch_updated_at();

-- Row Level Security: every row belongs to exactly one signed-in user.
alter table public.devices enable row level security;
alter table public.jobs enable row level security;

create policy "Users read their devices" on public.devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users add their devices" on public.devices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update their devices" on public.devices
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users remove their devices" on public.devices
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "Users read their jobs" on public.jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Devices report jobs" on public.jobs
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid()))
  );
create policy "Devices update jobs" on public.jobs
  for update to authenticated using (user_id = (select auth.uid())) with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid()))
  );
create policy "Users remove their jobs" on public.jobs
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.devices, public.jobs from anon;

-- Live updates on the website dashboard (Realtime honours the policies above).
alter publication supabase_realtime add table public.devices, public.jobs;

-- "Delete my account" removes the auth user; devices and jobs cascade.
create function public.delete_account() returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
