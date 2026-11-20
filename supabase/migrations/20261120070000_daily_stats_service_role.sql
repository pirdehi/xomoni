-- The admin role keeps what it has on every other table (#149's hardening): the local stack's tests seed daily numbers
-- with it (#252). The apps never hold this key (SECURITY.md); anon and authenticated stay as #250 left them.
grant all on public.daily_stats, public.daily_stats_choices to service_role;
