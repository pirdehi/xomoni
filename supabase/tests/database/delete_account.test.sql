-- delete_account() needs a sign-in within the last 10 minutes (#80), read from the JWT's `amr` claim.
-- Run with `supabase test db`.
begin;
select plan(6);

insert into auth.users (id, email, aud, role)
values ('00000000-0000-4000-a000-00000000002a', 'cy@delete.test.xomoni.com', 'authenticated', 'authenticated');

-- Claims for Cy with these sign-in methods, each `[method, minutes ago]`; an empty array means no `amr`.
create function pg_temp.sign_in(methods jsonb) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-a000-00000000002a', 'role', 'authenticated',
    'amr', (
      select jsonb_agg(jsonb_build_object(
        'method', m ->> 0, 'timestamp', extract(epoch from now())::bigint - (m ->> 1)::int * 60))
      from jsonb_array_elements(methods) as m
    )
  )::text, true);
end $$;

set local role authenticated;

do $$ begin perform pg_temp.sign_in('[]'); end $$;
select throws_ok('select public.delete_account()', 'P0001', 'Sign in again to delete your account.',
  'a session without sign-in times can''t delete the account');

do $$ begin perform pg_temp.sign_in('[["password", 11]]'); end $$;
select throws_ok('select public.delete_account()', 'P0001', 'Sign in again to delete your account.',
  'a sign-in 11 minutes ago is too old');

-- A refreshed token keeps its old sign-in times; none of them is recent.
do $$ begin perform pg_temp.sign_in('[["oauth", 120], ["otp", 15]]'); end $$;
select throws_ok('select public.delete_account()', 'P0001', null, 'every sign-in method is older than 10 minutes');

reset role;
select is((select count(*)::int from auth.users where email = 'cy@delete.test.xomoni.com'), 1,
  'Cy''s account is still there');

set local role authenticated;
do $$ begin perform pg_temp.sign_in('[["oauth", 120], ["password", 2]]'); end $$;
select lives_ok('select public.delete_account()', 'a sign-in 2 minutes ago may delete the account');

reset role;
select is((select count(*)::int from auth.users where email = 'cy@delete.test.xomoni.com'), 0, 'Cy''s account is gone');

select * from finish();
rollback;
