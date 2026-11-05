-- Pairing says which account a browser joins (#149). Someone tricked into typing another person's code would
-- otherwise stream their job status to that person, seeing only "Connected". pair_device now also returns the
-- account's email, masked, and the extension sends nothing until the person confirms it is theirs.

-- An email as a hint the owner recognizes and nobody else learns much from: its first character and its domain.
create function public.mask_email(email text) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when email is null or position('@' in email) < 2 then '•••'
    else left(email, 1) || '•••@' || split_part(email, '@', 2)
  end;
$$;
revoke execute on function public.mask_email(text) from public, anon, authenticated;

-- As before, plus `account`. The return type changes, so it is dropped and created again, with its grants.
drop function public.pair_device(text, text, text);

create function public.pair_device(code text, name text, version text)
returns table (device_id uuid, token text, account text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  fresh boolean;
  new_device uuid;
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.device_pairings p
  where p.code_hash = extensions.digest(public.normalize_pairing_code(code), 'sha256')
  returning p.user_id, p.expires_at > now() into owner, fresh;
  if owner is null or not fresh then
    raise exception 'This code is not valid. Get a new one on xomoni.com.' using errcode = 'P0001', hint = 'bad_code';
  end if;
  insert into public.devices (user_id, name, extension_version)
  values (owner, left(coalesce(nullif(trim(name), ''), 'Browser'), 80), left(coalesce(nullif(version, ''), '0'), 32))
  returning id into new_device;
  insert into public.device_tokens (device_id, token_hash) values (new_device, extensions.digest(secret, 'sha256'));
  return query
    select new_device, secret, public.mask_email(u.email::text) from auth.users u where u.id = owner;
end;
$$;

revoke execute on function public.pair_device(text, text, text) from public, anon, authenticated;
grant execute on function public.pair_device(text, text, text) to anon, authenticated;
