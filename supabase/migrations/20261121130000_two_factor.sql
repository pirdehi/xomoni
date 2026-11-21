-- Two-step verification (#173, ADR-0036): an account with an authenticator app is used only from a session that
-- verified a code from it (the access token's `aal` claim is `aal2`). Supabase Auth already refuses, below aal2, to add
-- another app, remove one, or change the email or password. This makes the database refuse the rest below aal2:
-- reading or changing the account's devices, jobs, daily numbers and weekly email, joining its live dashboard channel,
-- making a pairing code and deleting the account. So a stolen password or session alone can't read or change the
-- account through the Data API either, whatever the website does.
--
-- An account without an app is unchanged: any of its sessions may. An app someone started adding and never confirmed
-- (status `unverified`) asks for nothing. The policies are restrictive, so they add to the owner checks and never widen
-- them. The extension's own functions take a device token, not a session (ADR-0018), and are unchanged.

-- ── The rule ──────────────────────────────────────────────────────────────────────────────────────
-- True when the session verified a code, or the signed-in account has no verified authenticator app. Security definer:
-- `authenticated` can't read `auth.mfa_factors`. It says nothing about anyone else, so the Data API may call it.
create function public.mfa_satisfied() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    );
$$;

revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

-- For the account functions below: stops the call, with a hint the website maps to its code page.
create function public.require_second_factor() returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.mfa_satisfied() then
    raise exception 'Enter a code from your authenticator app first.'
      using errcode = 'P0001', hint = 'second_factor_required';
  end if;
end;
$$;

revoke execute on function public.require_second_factor() from public, anon, authenticated;

-- ── Tables: restrictive policies for signed-in people ──────────────────────────────────────────────
create policy "Accounts with an authenticator app need aal2" on public.devices
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "Accounts with an authenticator app need aal2" on public.jobs
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "Accounts with an authenticator app need aal2" on public.daily_stats
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

create policy "Accounts with an authenticator app need aal2" on public.daily_stats_choices
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

create policy "Accounts with an authenticator app need aal2" on public.weekly_emails
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

-- The live dashboard channel (`dashboard:<user id>`, #81): joining it is reading the account's changes.
create policy "Accounts with an authenticator app need aal2" on realtime.messages
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

-- ── Functions a signed-in person calls ─────────────────────────────────────────────────────────────
-- As in 20261031122124 (#80), after the check.
create or replace function public.delete_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  amr jsonb := auth.jwt() -> 'amr';
  signed_in_at bigint;
begin
  perform public.require_second_factor();
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

-- As in 20261102034558 (ADR-0018), after the check: a code pairs a browser with the account.
create or replace function public.create_pairing_code() returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(10);
  raw text := '';
  until timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  perform public.require_second_factor();
  for i in 0..9 loop
    raw := raw || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.device_pairings (user_id, code_hash, expires_at)
  values (auth.uid(), extensions.digest(raw, 'sha256'), until)
  on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
  return query select substr(raw, 1, 5) || '-' || substr(raw, 6, 5), until;
end;
$$;

-- As in 20261120030000 (#250), after the check.
create or replace function public.set_daily_stats(enabled boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_second_factor();
  return public.choose_daily_stats((select auth.uid()), set_daily_stats.enabled);
end;
$$;

-- As in 20261120150000 (#257), after the check.
create or replace function public.set_weekly_email(enabled boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := (select auth.uid());
begin
  if owner is null then
    raise exception 'Sign in to choose the weekly email.' using errcode = 'P0001';
  end if;
  perform public.require_second_factor();
  if set_weekly_email.enabled
     and not exists (select 1 from public.daily_stats_choices c where c.user_id = owner and c.enabled) then
    raise exception 'Turn on your daily numbers first.' using errcode = 'P0001';
  end if;
  insert into public.weekly_emails as w (user_id, enabled, changed_at)
  values (owner, set_weekly_email.enabled, now())
  on conflict (user_id) do update set enabled = excluded.enabled, changed_at = now();
  return set_weekly_email.enabled;
end;
$$;
