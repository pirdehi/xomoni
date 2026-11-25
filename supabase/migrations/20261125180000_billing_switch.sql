-- Sales' switch for the pricing page and the tests (#422, ADR-0042). Whether sales are open is public: xomoni.com's
-- /pricing says *Coming soon* to every visitor until they are, so anyone may ask `billing_live()`, which answers that
-- one boolean and nothing else. The admin role may turn the switch, as the maintainer does from the SQL editor, so the
-- browser tests can open sales on the local stack; the apps hold that key only in billing's server-only writer. Nobody
-- else reads or writes `billing_settings`, and the ledger and the plans are unchanged.
grant execute on function public.billing_live() to anon, authenticated;
grant update (live, changed_at) on public.billing_settings to service_role;
