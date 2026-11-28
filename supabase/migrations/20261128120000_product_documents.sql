-- Private product documents at xomoni.com/product, for the site's super-admins only (ADR-0048). The documents carry
-- the product's strategy, so they live only in this database, never in the public repository: the migration makes the
-- tables, and the maintainer adds the content and the first super-admin with SQL. A document is never changed in place:
-- each upload adds a version, so its history stays. No X content is stored here (ADR-0004).

-- ── Who is a super-admin ────────────────────────────────────────────────────────────────────────
-- One row per super-admin account. The first row is added by the maintainer in the SQL editor (by user id, so no email
-- lands in the repository); the apps can't add or read rows.
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role = 'superadmin'),
  created_at timestamptz not null default now()
);

-- Row Level Security with no policy: neither anon nor authenticated reads or writes it.
alter table public.app_admins enable row level security;

-- The admin role reads and writes it, as it does the other tables (#149), so the local stack's tests can add one.
grant select, insert, delete on public.app_admins to service_role;

-- Whether the signed-in account is a super-admin. Security definer, so it can read app_admins, which the caller can't.
create function public.is_superadmin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins a
    where a.user_id = (select auth.uid()) and a.role = 'superadmin')
$$;

revoke execute on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated;

-- ── The documents: one row per version ──────────────────────────────────────────────────────────
create table public.product_documents (
  id bigint generated always as identity primary key,
  -- Which document: `product` is the one xomoni.com/product shows.
  slug text not null check (slug ~ '^[a-z0-9-]{1,40}$'),
  title text not null check (char_length(title) between 1 and 200),
  -- A whole HTML page, served sandboxed with its own Content-Security-Policy (ADR-0048).
  html text not null check (octet_length(html) between 1 and 1000000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid()
);

create index product_documents_slug_created_at on public.product_documents (slug, created_at desc);

alter table public.product_documents enable row level security;

create policy "Super-admins read product documents" on public.product_documents
  for select to authenticated using ((select public.is_superadmin()));

create policy "Super-admins add versions" on public.product_documents
  for insert to authenticated
  with check ((select public.is_superadmin()) and created_by = (select auth.uid()));

-- As for the account's other data (ADR-0036): an account with an authenticator app reads and adds only at aal2.
create policy "Accounts with an authenticator app need aal2 to read" on public.product_documents
  as restrictive for select to authenticated
  using ((select public.mfa_satisfied()));

create policy "Accounts with an authenticator app need aal2 to add" on public.product_documents
  as restrictive for insert to authenticated
  with check ((select public.mfa_satisfied()));

-- Read and add only: a version is never changed or deleted by the apps.
grant select, insert on public.product_documents to authenticated;
grant select, insert, delete on public.product_documents to service_role;
