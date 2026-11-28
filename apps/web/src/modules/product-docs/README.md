# `modules/product-docs`: the private product document

Serves the product document at `/product` to the site's super-admins and nobody else ([ADR-0048](../../../../../docs/adr/0048-a-private-product-document-for-super-admins.md)). The document carries the product's strategy, so it is never in this repository: it lives only in the database (`public.product_documents`), one row per version, added by a super-admin at `/product/manage` or by the maintainer with SQL. A version is never changed or deleted.

Who is a super-admin is in `public.app_admins`, which the maintainer fills with SQL by user id; the apps can't read or change it. Row Level Security lets only a super-admin read or add a version (`public.is_superadmin()`), and an account with an authenticator app only at aal2, so the database refuses everyone else whatever the website does.

The document is a whole HTML page with its own inline scripts and styles. `/product` serves it as it is, not inside the site's pages, with its own Content-Security-Policy (`privateDocumentPolicy` in `shared/config/security-headers.ts`, set for the path in `next.config.ts`): a sandbox with an opaque origin, so its scripts can never read xomoni.com's cookies, storage or session; Google Fonts and data: images only; no requests, forms, base URL or framing.

## Layers

| Layer             | Files                      | Responsibility                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/`         | `document.ts`              | `ProductDocument` and its versions; `checkDocument` (a title of 1 to 200 characters, an HTML page of at most 900 KB); `prepareDocumentHtml`, which adds a doctype when missing, a small _Versions_ link to `/product/manage`, and a script that opens links to other sites in a new tab; the messages for each refusal.                                                    |
| `application/`    | `ports.ts`, `product-docs.ts` | Port `ProductDocumentStore`. `openDocument` (the newest version or the one named, `forbidden` for anyone who isn't a super-admin, whatever exists), `listVersions`, `addVersion` (checked first, then stored as the signed-in super-admin).                                                                                                                      |
| `infrastructure/` | `supabase-product-docs.ts` | The store on Supabase, as the signed-in person: `is_superadmin()`, reads newest first, and inserts that leave the author to the database (`created_by` defaults to `auth.uid()`, and the policy checks it).                                                                                                                                                         |
| `server/`         | `document.ts`              | `handleProductDocument` for `GET /product`: a signed-out visitor goes to sign in and back; anyone signed in who isn't a super-admin gets a plain 404; a super-admin gets the page, `private, no-store` and `noindex`. `?v=` names an earlier version. `loadManageView` for `/product/manage`: the versions, or the site's 404.                                       |
| `client/`         | `product-docs.ts`          | `browserProductDocs.addVersion`: a new version goes from the super-admin's browser straight to Supabase, where Row Level Security checks again.                                                                                                                                                                                                                     |
| `ui/`             | `manage.tsx`               | `ProductDocsManage`: open the current version, upload a new one as an HTML file with a title, and the versions, newest first, each opening its own page.                                                                                                                                                                                                             |

## Used by

- `app/product/route.ts`: `GET /product`.
- `app/product/manage/page.tsx`: `/product/manage`.
- `proxy.ts` keeps the session fresh on `/product` and sends signed-out visitors to sign in (`ROUTES.product` in `modules/auth`).

## Making someone a super-admin

In the Supabase SQL editor, as the maintainer, with the account's user id (never an email in this repository):

```sql
insert into public.app_admins (user_id, role) values ('<user id>', 'superadmin');
```

## Tests

Next to each file: `domain/` (the checks, the added link and script), `application/` with a fake store (who may read or add, refusals before any write), the adapter with a scripted Supabase client (the queries it sends, and that it never names a user id), `server/` (the route's answers and headers for a super-admin, anyone else and a signed-out visitor), `client/`, and `ui/` in happy-dom (the list, an upload and a refusal). `shared/config/security-headers.test.ts` pins the document's policy. `supabase/tests/database/product_documents.test.sql` proves the database's side: only a super-admin reads or adds, nobody changes or deletes a version, nobody but the admin role touches `app_admins`, aal2 for an account with an authenticator app, and the size and shape limits. End to end: `e2e/product-document.spec.ts`.
