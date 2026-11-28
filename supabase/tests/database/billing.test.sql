-- Payments (#420, ADR-0042): the plan, the ledger of Polar's webhooks and the switch that opens sales. Proves that the
-- tables hold no X content, email or card; that only service_role writes, through apply_billing_event(); that the same
-- webhook twice has one effect and an older event changes nothing; that the plan that counts follows its status and
-- its end; that each person, and each connected browser, reads only their own account's plan; that two-step
-- verification guards it; and that deleting the account deletes it. Run with `supabase test db`.
begin;
select plan(68);

-- Bea will pay, Cal never does, Dan has an authenticator app.
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-0000000000b1', 'bea@billing.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000b2', 'cal@billing.test.xomoni.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000b3', 'dan@billing.test.xomoni.com', 'authenticated', 'authenticated');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('00000000-0000-4000-f000-0000000000b3', '00000000-0000-4000-a000-0000000000b3', 'Phone', 'totp', 'verified',
  now(), now(), 'JBSWY3DPEHPK3PXP');

-- A connected browser each for Bea and Cal, with tokens as pairing would make them.
insert into public.devices (id, user_id, name, extension_version)
values
  ('00000000-0000-4000-b000-0000000000b1', '00000000-0000-4000-a000-0000000000b1', 'Bea laptop', '0.6.0'),
  ('00000000-0000-4000-b000-0000000000b2', '00000000-0000-4000-a000-0000000000b2', 'Cal laptop', '0.6.0');
insert into public.device_tokens (device_id, token_hash)
values
  ('00000000-0000-4000-b000-0000000000b1', extensions.digest('bea-token', 'sha256')),
  ('00000000-0000-4000-b000-0000000000b2', extensions.digest('cal-token', 'sha256'));

-- Claims for `who` at assurance level `aal`, signed in a minute ago.
create function pg_temp.session(who text, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', who, 'role', 'authenticated', 'aal', aal,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 60))
  )::text, true);
end $$;
grant execute on function pg_temp.session(text, text) to authenticated;

-- One of Polar's events for Bea, as the webhook route passes it on.
create function pg_temp.bea_event(id text, at interval, tier text, status text, source text, until interval,
  cancel boolean default false) returns text language sql as $$
  select public.apply_billing_event(id, 'subscription.updated', now() - at, '00000000-0000-4000-a000-0000000000b1',
    tier, status, source, now() + until, cancel, true, 'cus_bea', 'sub_bea')
$$;
grant execute on function pg_temp.bea_event(text, interval, text, text, text, interval, boolean) to service_role;

-- ── What the tables hold, and who may reach them ─────────────────────────────────────────────────
select is_empty(
  $$ select table_name || '.' || column_name from information_schema.columns
     where table_schema = 'public' and table_name in ('entitlements', 'billing_events', 'billing_settings')
       and column_name ~ '(^|_)(email|name|address|card|handle|post|body|text|phone|country|ip)(_|$)' $$,
  'no column holds an email, a name, an address, a card, an event body or X content');
select is_empty(
  $$ select table_name || ' ' || privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_name in ('entitlements', 'billing_events', 'billing_settings') $$,
  'anon has no privilege on the plan, the ledger or the switch');
select is(
  (select string_agg(table_name || ' ' || privilege_type, ', ')::text from information_schema.role_table_grants
   where grantee = 'authenticated' and table_name in ('entitlements', 'billing_events', 'billing_settings')),
  'entitlements SELECT', 'a signed-in person may only read the plan, and nothing of the ledger or the switch');
select ok(
  has_function_privilege('service_role',
    'public.apply_billing_event(text, text, timestamptz, uuid, text, text, text, timestamptz, boolean, boolean, text, text)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.apply_billing_event(text, text, timestamptz, uuid, text, text, text, timestamptz, boolean, boolean, text, text)',
    'execute')
  and not has_function_privilege('anon',
    'public.apply_billing_event(text, text, timestamptz, uuid, text, text, text, timestamptz, boolean, boolean, text, text)',
    'execute'),
  'only service_role may apply an event');
select ok(
  not has_function_privilege('anon', 'public.entitlement_of(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.entitlement_of(uuid)', 'execute'),
  'nobody asks for another account''s plan directly');
select ok(
  has_function_privilege('anon', 'public.billing_live()', 'execute')
    and has_function_privilege('authenticated', 'public.billing_live()', 'execute'),
  'anyone may ask whether sales are open, which the pricing page says to every visitor (#422)');
select results_eq('select live from public.billing_settings', array[false], 'the switch is one row, and sales are closed');
select throws_ok($$ insert into public.billing_settings (id, live) values (false, true) $$, '23514', null,
  'there is no second switch');

-- ── The webhook writes, once per event and never backwards ───────────────────────────────────────
set local role service_role;
select is(pg_temp.bea_event('evt-1', '5 hours', 'plus', 'active', 'subscription', '30 days'), 'applied',
  'a new subscription is applied');
select is(pg_temp.bea_event('evt-1', '5 hours', 'pro', 'active', 'subscription', '30 days'), 'ignored',
  'the same webhook delivered again is ignored, whatever it carries');
reset role;
select results_eq(
  $$ select tier, status, source, founding, cancel_at_period_end, polar_customer_id, polar_subscription_id
     from public.entitlements where user_id = '00000000-0000-4000-a000-0000000000b1' $$,
  $$ values ('plus', 'active', 'subscription', true, false, 'cus_bea', 'sub_bea') $$,
  'so the plan is the first delivery''s, with Polar''s ids and nothing about the person');
select results_eq($$ select type, result from public.billing_events where webhook_id = 'evt-1' $$,
  $$ values ('subscription.updated', 'applied') $$, 'the ledger keeps one row for the event, with its type and result');

set local role service_role;
select is(pg_temp.bea_event('evt-0', '6 hours', 'free', 'revoked', 'subscription', '0 days'), 'stale',
  'an event older than the plan is stale');
reset role;
select results_eq(
  $$ select tier, status from public.entitlements where user_id = '00000000-0000-4000-a000-0000000000b1' $$,
  $$ values ('plus', 'active') $$, 'and changes nothing, so a late retry can''t undo a newer state');
select is((select result from public.billing_events where webhook_id = 'evt-0'), 'stale', 'the ledger says so');

set local role service_role;
select is(pg_temp.bea_event('evt-2', '4 hours', 'plus', 'canceled', 'subscription', '20 days', true), 'applied',
  'a newer event is applied');
select is(
  public.apply_billing_event('evt-gone', 'subscription.revoked', now() - interval '1 hour',
    '00000000-0000-4000-a000-0000000000ff', 'free', 'revoked', 'subscription', null),
  'ignored', 'an event for an account that no longer exists is ignored');
reset role;
select is_empty($$ select 1 from public.entitlements where user_id = '00000000-0000-4000-a000-0000000000ff' $$,
  'and makes no plan');
select is((select result from public.billing_events where webhook_id = 'evt-gone'), 'ignored', 'the ledger says so');

-- ── An event that is not one is refused, and leaves no trace ─────────────────────────────────────
set local role service_role;
select throws_ok($$ select public.apply_billing_event('evt-future', 'subscription.updated', now() + interval '1 hour',
  '00000000-0000-4000-a000-0000000000b2', 'plus', 'active', 'subscription', now() + interval '30 days') $$,
  '22023', 'An event needs a time that has come.', 'an event from the future is refused: it would make later ones stale');
select throws_ok($$ select public.apply_billing_event(null, 'subscription.updated', now(),
  '00000000-0000-4000-a000-0000000000b2', 'plus', 'active', 'subscription', now() + interval '30 days') $$,
  '22023', null, 'an event without its webhook id is refused');
select throws_ok($$ select public.apply_billing_event('evt-type', 'Subscription Updated', now(),
  '00000000-0000-4000-a000-0000000000b2', 'plus', 'active', 'subscription', now() + interval '30 days') $$,
  '22023', null, 'so is an event whose type isn''t one');
select throws_ok($$ select public.apply_billing_event('evt-nobody', 'subscription.updated', now(),
  null, 'plus', 'active', 'subscription', now() + interval '30 days') $$,
  '22023', null, 'so is an event for no account');
select throws_ok($$ select public.apply_billing_event('evt-gold', 'subscription.updated', now(),
  '00000000-0000-4000-a000-0000000000b2', 'gold', 'active', 'subscription', now() + interval '30 days') $$,
  '23514', null, 'so is a plan that doesn''t exist');
select throws_ok($$ select public.apply_billing_event('evt-forever', 'subscription.updated', now(),
  '00000000-0000-4000-a000-0000000000b2', 'plus', 'active', 'subscription', null) $$,
  '23514', null, 'and a paid plan without an end, so a lost event can''t leave one that never ends');
reset role;
select is_empty($$ select webhook_id from public.billing_events
  where webhook_id in ('evt-future', 'evt-type', 'evt-gold', 'evt-forever') $$,
  'a refused event leaves no row in the ledger, so Polar''s retry is applied once it is fixed');
select is_empty($$ select 1 from public.entitlements where user_id = '00000000-0000-4000-a000-0000000000b2' $$,
  'and no plan');

-- ── The plan that counts ─────────────────────────────────────────────────────────────────────────
select is(public.entitlement_of('00000000-0000-4000-a000-0000000000b1') ->> 'tier', 'plus',
  'a canceled subscription is still Plus until the end of the period paid for');
set local role service_role;
select is(pg_temp.bea_event('evt-3', '3 hours', 'plus', 'canceled', 'subscription', '-1 minute', true), 'applied',
  'the period ends');
reset role;
select is(public.entitlement_of('00000000-0000-4000-a000-0000000000b1'),
  jsonb_build_object('tier', 'free', 'status', 'canceled', 'valid_until', now() - interval '1 minute'),
  'once the period has passed the plan counts as Free, and still says how it ended and when');
set local role service_role;
select is(pg_temp.bea_event('evt-4', '2 hours', 'plus', 'revoked', 'subscription', '30 days'), 'applied',
  'Polar revokes a plan');
reset role;
select is(public.entitlement_of('00000000-0000-4000-a000-0000000000b1') ->> 'tier', 'free',
  'a revoked plan is Free, whatever its end says');
set local role service_role;
select is(pg_temp.bea_event('evt-5', '1 hour', 'plus', 'active', 'pass', '30 days'), 'applied',
  'a one-time pass is applied');
reset role;
select results_eq(
  $$ select public.entitlement_of(user_id) ->> 'tier', source from public.entitlements
     where user_id = '00000000-0000-4000-a000-0000000000b1' $$,
  $$ values ('plus', 'pass') $$, 'a 30-day pass is Plus while it lasts');
set local role service_role;
select is(pg_temp.bea_event('evt-6', '30 minutes', 'pro', 'trialing', 'subscription', '14 days'), 'applied',
  'a Pro trial is applied');
reset role;
select is(public.entitlement_of('00000000-0000-4000-a000-0000000000b1') ->> 'tier', 'pro', 'a trial counts as its plan');
select is(public.entitlement_of('00000000-0000-4000-a000-0000000000b2'),
  '{"tier": "free", "status": null, "valid_until": null}'::jsonb, 'an account that never paid is Free');

-- ── Nobody else reads or writes it ───────────────────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.entitlements', '42501', null, 'anon can''t read any plan');
select throws_ok('select * from public.billing_events', '42501', null, 'nor the ledger');
select throws_ok('select * from public.billing_settings', '42501', null, 'nor the switch');
select throws_ok('select public.my_entitlement()', '42501', null, 'nor ask for a plan');
select throws_ok($$ select public.apply_billing_event('evt-anon', 'subscription.updated', now(),
  '00000000-0000-4000-a000-0000000000b2', 'pro', 'active', 'subscription', now() + interval '1 year') $$,
  '42501', null, 'nor apply an event');

set local role authenticated;
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000b2', 'aal1'); end $$;
select is_empty('select user_id from public.entitlements', 'another person reads none of Bea''s plan');
select is(public.my_entitlement(),
  '{"entitlement": {"tier": "free", "status": null, "valid_until": null}, "billing_live": false}'::jsonb,
  'and asking gives their own plan, Free, not hers');
select throws_ok($$ insert into public.entitlements (user_id, tier, status, source, valid_until, event_at)
  values ('00000000-0000-4000-a000-0000000000b2', 'pro', 'active', 'subscription', now() + interval '1 year', now()) $$,
  '42501', null, 'nobody writes a plan directly, not even their own');
select throws_ok($$ update public.entitlements set tier = 'free' $$, '42501', null, 'nor changes one');
select throws_ok($$ delete from public.entitlements $$, '42501', null, 'nor deletes one');
select throws_ok('select * from public.billing_events', '42501', null, 'a signed-in person can''t read the ledger');
select throws_ok($$ update public.billing_settings set live = true $$, '42501', null, 'nor open sales');
select throws_ok($$ select public.apply_billing_event('evt-self', 'subscription.updated', now(),
  '00000000-0000-4000-a000-0000000000b2', 'pro', 'active', 'subscription', now() + interval '1 year') $$,
  '42501', null, 'nor apply an event to give themselves a plan');

do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000b1', 'aal1'); end $$;
select results_eq('select tier, status from public.entitlements', $$ values ('pro', 'trialing') $$,
  'the owner reads their own plan');
select is(public.my_entitlement() -> 'entitlement' ->> 'tier', 'pro', 'and asking gives it');

-- ── Two-step verification guards it (ADR-0036) ───────────────────────────────────────────────────
reset role;
insert into public.entitlements (user_id, tier, status, source, valid_until, event_at)
values ('00000000-0000-4000-a000-0000000000b3', 'plus', 'active', 'subscription', now() + interval '30 days', now());
set local role authenticated;
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000b3', 'aal1'); end $$;
select is_empty('select user_id from public.entitlements', 'Dan''s password alone reads none of his plan');
select throws_ok('select public.my_entitlement()', 'P0001', 'Enter a code from your authenticator app first.',
  'nor asks for it');
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000b3', 'aal2'); end $$;
select results_eq('select tier from public.entitlements', array['plus'], 'after a code from his app, he reads it');

-- ── Each connected browser learns its own account's plan ─────────────────────────────────────────
set local role anon;
select is(public.device_report('bea-token', '0.6.0') -> 'entitlement',
  jsonb_build_object('tier', 'pro', 'status', 'trialing', 'valid_until', now() + interval '14 days'),
  'Bea''s browser hears her plan in its heartbeat');
select is(public.device_report('cal-token', '0.6.0') -> 'entitlement',
  '{"tier": "free", "status": null, "valid_until": null}'::jsonb,
  'Cal''s browser hears only his own, Free, never hers');
select results_eq($$ select jsonb_object_keys(public.device_report('bea-token', '0.6.0')) order by 1 $$,
  array['billing_live', 'entitlement', 'latest', 'security', 'stats'],
  'the rest of the answer is as before: the release and the daily numbers'' choice');
select is((public.device_report('bea-token', '0.6.0') ->> 'billing_live')::boolean, false,
  'and it says sales are closed');
reset role;
update public.billing_settings set live = true;
set local role anon;
select is((public.device_report('cal-token', '0.6.0') ->> 'billing_live')::boolean, true,
  'until the maintainer opens them, which needs no release');
select throws_ok($$ select public.device_report('not-a-token', '0.6.0') $$, 'P0001', null,
  'an unknown token hears no plan at all');

-- ── The switch: anyone may read it through billing_live(), only the admin role turns it (#422) ────
reset role;
update public.billing_settings set live = false;
set local role anon;
select is(public.billing_live(), false, 'a visitor hears that sales are closed');
select throws_ok($$ update public.billing_settings set live = true $$, '42501', null, 'and can''t open them');
set local role service_role;
select lives_ok($$ update public.billing_settings set live = true, changed_at = now() $$,
  'the admin role opens sales, as the maintainer does');
set local role authenticated;
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000b2', 'aal1'); end $$;
select is(public.billing_live(), true, 'a signed-in person hears that sales are open');
select throws_ok($$ update public.billing_settings set live = false $$, '42501', null, 'and can''t close them');

-- ── Deleting the account deletes its plan ────────────────────────────────────────────────────────
set local role authenticated;
do $$ begin perform pg_temp.session('00000000-0000-4000-a000-0000000000b1', 'aal1'); end $$;
select lives_ok('select public.delete_account()', 'Bea deletes her account');
reset role;
select is_empty($$ select 1 from public.entitlements where user_id = '00000000-0000-4000-a000-0000000000b1' $$,
  'and her plan is gone with it');

select * from finish();
rollback;
