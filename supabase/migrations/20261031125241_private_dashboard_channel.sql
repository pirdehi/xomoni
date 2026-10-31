-- One private Realtime channel per dashboard viewer (#81). Every dashboard used to join the same public
-- topic, `dashboard`, so anyone with the publishable key could join it and broadcast to every open
-- dashboard. The website now joins `dashboard:<user id>` as a private channel, and Realtime admits a
-- signed-in user only to their own topic. Row Level Security on `jobs` and `devices` still decides which
-- changes reach them.
create policy "Viewers join their own dashboard channel" on realtime.messages
  for select to authenticated
  using ((select realtime.topic()) = 'dashboard:' || (select auth.uid())::text);
