-- Live dashboard updates as broadcasts on the owner's private topic only (#149, #81). Until now `devices` and
-- `jobs` were in the `supabase_realtime` publication. Row Level Security filters inserts and updates there,
-- but not deletes, so any subscriber could see the ids of everyone's deleted rows. Now a trigger sends each
-- change only to `dashboard:<owner>`, which the policy on `realtime.messages` lets no one else join, and the
-- tables leave the publication.
create function public.dashboard_broadcast() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'dashboard:' || coalesce(new.user_id, old.user_id)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return null;
end;
$$;
revoke execute on function public.dashboard_broadcast() from public, anon, authenticated;

create trigger devices_dashboard_broadcast
after insert or update or delete on public.devices
for each row execute function public.dashboard_broadcast();

create trigger jobs_dashboard_broadcast
after insert or update or delete on public.jobs
for each row execute function public.dashboard_broadcast();

alter publication supabase_realtime drop table public.devices, public.jobs;
