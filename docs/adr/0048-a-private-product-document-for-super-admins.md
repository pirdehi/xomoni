# ADR-0048: A private product document for super-admins, kept only in the database

- Status: Accepted
- Date: 2026-11-28

## Context

The maintainer keeps a product document: the product's direction, plans, prices under consideration and decisions. Until now it lived in a private repository and on outside pages. The maintainer asked for one place that only they can open, on xomoni.com itself, at `/product`, where it is also updated.

The document must not enter this repository, which is public: strategy and prices stay out of it. The website has no admin role, no service-role key (`SECURITY.md`), and a Content-Security-Policy that forbids inline-script exceptions per route and any framing ([ADR-0014](0014-security-headers-and-a-static-csp.md)). The document is a designed HTML page with its own inline styles and scripts, which the site's policy and its Trusted Types would block, and which must never be able to reach the site's session.

## Decision

1. **Super-admins.** A new table, `public.app_admins`, names them by user id with the role `superadmin`. The maintainer adds rows with SQL; no migration names a person, so no email or user id enters the repository. Neither `anon` nor `authenticated` can read or change it. `public.is_superadmin()` (security definer) tells the signed-in person whether they are one.
2. **The document lives only in the database.** `public.product_documents` holds one row per version: a slug (`product` for `/product`), a title, the whole page (at most 1,000,000 bytes), when, and who. Row Level Security lets only a super-admin read or add a version, and the author must be the signed-in person. Nobody changes or deletes a version through the Data API, so the history stays. An account with an authenticator app reads and adds only at aal2, as for its other data ([ADR-0036](0036-two-step-verification-with-an-authenticator-app.md)).
3. **Served as it is, sandboxed.** `GET /product` returns the newest version (or the one `?v=` names) as a whole page, not inside the site's pages, with `private, no-store` and `noindex`. Its Content-Security-Policy replaces the site's on that path only (`next.config.ts`, the same way `EMBEDDABLE_PATHS` replaces a header):
   - `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`: the page has an opaque origin, so its scripts can't read xomoni.com's cookies, storage or session, even if the address is opened directly;
   - inline scripts and styles, Google Fonts and data: images only;
   - no requests, forms, base URL or framing.
   The route adds a doctype when missing, a small _Versions_ link to `/product/manage`, and a script that opens links to other sites in a new tab.
4. **Nobody else learns it exists.** A signed-out visitor is sent to sign in, as for every signed-in page. Anyone signed in who isn't a super-admin gets the same 404 as an address that doesn't exist, whatever is stored. `/product` is not in the sitemap or `robots.txt`.
5. **Updated there.** `/product/manage` lists the versions and takes a new one as an HTML file with a title, from the super-admin's browser straight to Supabase, where Row Level Security checks again. The maintainer may also add a version with SQL.

## Consequences

- The document is out of the repository and off outside pages; its only copy is the production database and its backups.
- A super-admin can open and update it from any browser where they are signed in; nobody else can, through the website or the Data API.
- The site's CSP and Trusted Types stay as they were everywhere else. The one path with a looser script policy runs in a sandbox, so a mistake in a document can't reach the site.
- The website still holds no service-role key: everything runs as the signed-in person.
- Adding another super-admin, or another private document under a new slug, needs SQL and, for a new path, a line in `PRIVATE_DOCUMENT_PATHS`.
