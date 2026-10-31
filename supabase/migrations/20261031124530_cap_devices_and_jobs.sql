-- Caps on what one account stores (#82). Nothing limited it: one signed-in user could insert hundreds of
-- devices in one request. Sign-up needs a captcha and a confirmed email, but one account could still fill
-- the database.
--
-- * Devices: at most 10 per account. An 11th is refused with the hint `device_limit`; the person disconnects
--   a browser on the dashboard first. A per-account advisory lock makes concurrent inserts count in turn.
-- * Jobs: at most 1,000 per device. Refusing would stop the extension's sync, so the oldest jobs (by last
--   update) beyond the cap are removed instead. The dashboard shows the newest 50.
--
-- Both are statement-level AFTER triggers, so a bulk insert is checked once, with all its rows visible.
-- They run as the caller, under the same Row Level Security as the insert itself.

create function public.enforce_device_limit() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
begin
  for owner in select distinct user_id from inserted order by user_id loop
    perform pg_advisory_xact_lock(hashtextextended('devices:' || owner::text, 0));
    if (select count(*) from public.devices where user_id = owner) > 10 then
      raise exception 'An account can connect at most 10 browsers. Disconnect one on the dashboard first.'
        using errcode = 'P0001', hint = 'device_limit';
    end if;
  end loop;
  return null;
end;
$$;

create trigger devices_limit
  after insert on public.devices
  referencing new table as inserted
  for each statement execute function public.enforce_device_limit();

create function public.prune_old_jobs() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.jobs
  where id in (
    select id from (
      select j.id, row_number() over (partition by j.device_id order by j.updated_at desc, j.id) as newest
      from public.jobs j
      where j.device_id in (select distinct device_id from inserted)
    ) ranked
    where ranked.newest > 1000
  );
  return null;
end;
$$;

create trigger jobs_prune
  after insert on public.jobs
  referencing new table as inserted
  for each statement execute function public.prune_old_jobs();

-- Trigger functions only; nobody calls them directly.
revoke execute on function public.enforce_device_limit(), public.prune_old_jobs() from public, anon, authenticated;
