-- delete_account() needs a recent sign-in (#80). A valid session alone used to be enough, so a stolen
-- session token could delete the account and its history in one call; the "type DELETE" prompt is only
-- in the page. The JWT's `amr` claim lists each way the session was authenticated (password, Google,
-- an email link) with its time; refreshing the token keeps those times. The newest must be within the
-- last 10 minutes, or the call fails with the hint `reauthentication_needed` and the page asks the person
-- to sign in again.
create or replace function public.delete_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  amr jsonb := auth.jwt() -> 'amr';
  signed_in_at bigint;
begin
  -- A missing, null or malformed claim counts as no sign-in at all.
  if jsonb_typeof(amr) is distinct from 'array' then
    amr := '[]'::jsonb;
  end if;
  select max((method ->> 'timestamp')::bigint)
    into signed_in_at
    from jsonb_array_elements(amr) as method;

  if signed_in_at is null or signed_in_at < extract(epoch from now()) - 600 then
    raise exception 'Sign in again to delete your account.'
      using errcode = 'P0001', hint = 'reauthentication_needed';
  end if;

  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
