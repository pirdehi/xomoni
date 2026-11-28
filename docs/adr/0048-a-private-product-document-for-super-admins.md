# ADR-0048: A private product document for super-admins, kept only in the database

- Status: Accepted
- Date: 2026-11-28

## Context

The maintainer keeps a product document: the product's direction, plans, prices under consideration and decisions. Until now it lived in a private repository and on outside pages. The maintainer asked for one place that only they can open, on xomoni.com itself, at `/product`, where it is also updated.

The document must not enter this repository, which is public: strategy and prices stay out of it. The website has no admin role, no service-role key (`SECURITY.md`), and a Content-Security-Policy that forbids inline-script exceptions per route and any framing ([ADR-0014](0014-security-headers-and-a-static-csp.md)). The document is a designed HTML page with its own inline styles and scripts, which the site's policy and its Trusted Types would block, and which must never be able to reach the site's session.

## Decision

1. **Super-admins.** A new table, `public.app_admins`, names them by user id with the role `superadmin`. The maintainer adds rows with SQL; no migration names a person, so no email or user id enters the repository. Neither `anon` nor `authenticated` can read or change it. `public.is_superadmin()` (security definer) tells the signed-in person whether they are one.
2. **The document lives only in the database.** `public.product_documents` holds one row per version: a slug (`product` for `/product`), a title, the whole page (at most 1,000,000 bytes), when, and who. Row Level Security lets only a super-admin read or add a version, and the author must be the signed-in person. Nobody changes or deletes a version through the Data API, so the history stays. An account with an authenticator app reads and adds only at aal2, as for its other data ([ADR-0036](0036-two-step-verification-with-an-authenticator-app.md)).
3. **Served as it is, sandboxed.** `GET /product` (since #516, `GET /product/document`) returns the newest version (or the one `?v=` names) as a whole page, not inside the site's pages, with `private, no-store` and `noindex`. Its Content-Security-Policy replaces the site's on that path only (`next.config.ts`, the same way `EMBEDDABLE_PATHS` replaces a header):
   - `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`: the page has an opaque origin, so its scripts can't read xomoni.com's cookies, storage or session, even if the address is opened directly;
   - inline scripts and styles, Google Fonts and data: images only;
   - no requests, forms, base URL or framing.
   The route adds a doctype when missing, a small _Versions_ link to `/product/manage`, and a script that opens links to other sites in a new tab.
4. **Nobody else learns it exists.** A signed-out visitor is sent to sign in, as for every signed-in page. Anyone signed in who isn't a super-admin gets the same 404 as an address that doesn't exist, whatever is stored. `/product` is not in the sitemap or `robots.txt`.
5. **Updated there.** `/product/manage` (since #516, `/product/documents` in the console) lists the versions and takes a new one as an HTML file with a title, from the super-admin's browser straight to Supabase, where Row Level Security checks again. The maintainer may also add a version with SQL.

## Consequences

- The document is out of the repository and off outside pages; its only copy is the production database and its backups.
- A super-admin can open and update it from any browser where they are signed in; nobody else can, through the website or the Data API.
- The site's CSP and Trusted Types stay as they were everywhere else. The one path with a looser script policy runs in a sandbox, so a mistake in a document can't reach the site.
- The website still holds no service-role key: everything runs as the signed-in person.
- Adding another super-admin, or another private document under a new slug, needs SQL and, for a new path, a line in `PRIVATE_DOCUMENT_PATHS`.

## Amended 2026-11-28: the super-admin console (#516)

`/product` is now a console for super-admins, and the product document is one page of it.

1. **The console.** `/product` shows an overview (accounts, new sign-ups, sign-ins, two-step verification, suspensions, browsers connected and active, the Xomoni versions in use, jobs, plans, the two emails, and sign-ups for each of the last 30 days). `/product/users` lists every account, searched, sorted and paged on the server through the address, with TanStack Table (MIT, headless) as the grid, as the maintainer asked. `/product/users/<id>` shows one account: its sign-in methods, two-step verification, plan, choices, browsers, its 20 latest jobs (status only, never X content, ADR-0004) and how many sessions it has. `/product/roadmap` shows the maintainer's private plan as their own tool publishes it to `public.product_plan` (one row, never in this repository): the single direction the product follows, stage by stage, the live state of the program in progress, the documents it is built from, and the horizons, objectives and phases, and `/product/audit` the audit log. The pages share a frame (`app/product/(console)/layout.tsx`): a header with the signed-in email and *Sign out*, and a sidebar on Fluent UI's navigation drawer that folds into a menu below 768 px.
2. **Its own sign-in.** `/product/login` takes an email, a password and the Turnstile check, from the browser straight to Supabase Auth as every sign-in does (ADR-0011); no Google, no sign-up. It then asks `is_superadmin()`; an account that isn't one is signed out again at once and gets the same answer as a wrong password, *These details don't open the console.*, so the page tells nobody whether an email has an account or what it may open. An account with an authenticator app gives its code on `/login/two-factor` first (ADR-0036). A signed-out visitor on any console page goes there and back; anyone may open it, and a super-admin already signed in goes straight on.
3. **Functions only, each audited.** The console reads and acts only through database functions the signed-in person calls: `admin_overview`, `admin_users`, `admin_user`, `admin_sign_out_user`, `admin_set_banned`, `admin_delete_user` and `admin_audit_log`. Each checks that the caller is a super-admin whose session meets the two-step rule and refuses with `42501` otherwise; none acts on the caller's own account or another super-admin's; each change (sign out everywhere, suspend, restore, delete) writes a line to `public.admin_audit` in the same transaction, which outlives both accounts and keeps only the domain of a deleted account's email. A suspension lasts until a super-admin restores the account (the database stores the year 9999: Supabase Auth can't read an endless ban). The website still holds no service-role key. Deleting an account in the console needs its email typed exactly.
4. **Nobody else learns it exists.** The proxy asks `is_superadmin()` on every console page and answers anyone signed in who isn't one with the site's own 404 page and a real 404 status, before the page renders: under Cache Components a page's own `notFound()` comes after the response has started, inside a 200. The layout draws the console's frame only for a super-admin; every page and every Server Action checks again (`requireSuperadmin`), and the database once more.
5. **Routes moved.** The document moved from `/product` to `/product/document` (`PRIVATE_DOCUMENT_PATHS` is now `['/product/document']`; the console's own pages keep the site's Content-Security-Policy), and its versions from `/product/manage` to `/product/documents`, the console's *Versions* page. The sidebar opens the document in a new tab, as a whole page of its own. `/product/manage` no longer exists.

The console is the `admin` module ([`apps/web/src/modules/admin`](../../apps/web/src/modules/admin/README.md)); its database is `supabase/migrations/*_admin_console.sql`, proven by `supabase/tests/database/admin_console.test.sql`.
