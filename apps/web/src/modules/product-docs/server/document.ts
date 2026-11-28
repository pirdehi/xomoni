import 'server-only';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/modules/auth/server/session';
import { createServerSupabase } from '@/shared/supabase/server';
import { listVersions, openDocument } from '../application/product-docs';
import type { ProductDocumentStore } from '../application/ports';
import {
  MANAGE_PATH,
  PRODUCT_DOCUMENT_SLUG,
  prepareDocumentHtml,
  type ProductDocumentVersion,
} from '../domain/document';
import { createSupabaseProductDocumentStore } from '../infrastructure/supabase-product-docs';

/** Where the product document is served: xomoni.com/product (ADR-0048). */
export const PRODUCT_PATH = '/product';

/** What the document's routes need; tests replace them. */
export interface ProductDocsDeps {
  /** Sends a signed-out visitor to sign in and back to `returnTo`; resolves once someone is signed in. */
  readonly signedIn: (returnTo: string) => Promise<unknown>;
  /** The store, as the signed-in person. */
  readonly store: () => Promise<ProductDocumentStore>;
}

const defaultDeps: ProductDocsDeps = {
  signedIn: requireViewer,
  store: async () => createSupabaseProductDocumentStore(await createServerSupabase()),
};

/** Headers for every answer of the document route; its Content-Security-Policy comes from `next.config.ts`. */
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const page = (status: number, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Xomoni</title></head><body style="font:15px/1.6 system-ui,sans-serif;margin:48px">${body}</body></html>`,
    { status, headers: HTML_HEADERS },
  );

/**
 * The version `?v=` names, as a positive integer; null without one; `invalid` when it is anything else, which the
 * route answers like an unknown version.
 */
export function versionParam(url: string): number | null | 'invalid' {
  const raw = new URL(url).searchParams.get('v');
  if (raw === null) return null;
  return /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : 'invalid';
}

/**
 * `GET /product`: the product document, for super-admins only (ADR-0048). A signed-out visitor is sent to sign in and
 * back. Anyone else signed in gets the same 404 as an address that doesn't exist, so the route says nothing about
 * what it holds. A super-admin gets the newest version, or the one `?v=` names, as a whole page with the versions link
 * and the link script added; the page runs sandboxed under its own policy, so its scripts can't reach the site.
 */
export async function handleProductDocument(request: Request, deps: ProductDocsDeps = defaultDeps): Promise<Response> {
  const version = versionParam(request.url);
  await deps.signedIn(version === null || version === 'invalid' ? PRODUCT_PATH : `${PRODUCT_PATH}?v=${version}`);
  const store = await deps.store();
  if (version === 'invalid') {
    return (await store.isSuperadmin()) ? page(404, '<p>No version with that number.</p>') : notFoundPage();
  }
  const result = await openDocument(store, PRODUCT_DOCUMENT_SLUG, version);
  if (result.status === 'forbidden') return notFoundPage();
  if (result.status === 'missing') {
    return version === null
      ? page(200, `<h1>No product document yet</h1><p><a href="${MANAGE_PATH}">Upload the first version</a>.</p>`)
      : page(404, `<p>No version with that number. <a href="${MANAGE_PATH}">See the versions</a>.</p>`);
  }
  return new Response(prepareDocumentHtml(result.document.html), { status: 200, headers: HTML_HEADERS });
}

function notFoundPage(): Response {
  return page(404, '<h1>404</h1><p>This page could not be found.</p>');
}

/** What the manage page shows: the document's versions, newest first. */
export interface ManageView {
  readonly versions: ProductDocumentVersion[];
}

/**
 * The manage page's data (`/product/manage`): sends a signed-out visitor to sign in and back; anyone signed in who
 * isn't a super-admin gets the site's 404.
 */
export async function loadManageView(deps: ProductDocsDeps = defaultDeps): Promise<ManageView> {
  await deps.signedIn(MANAGE_PATH);
  const result = await listVersions(await deps.store(), PRODUCT_DOCUMENT_SLUG);
  if (result.status === 'forbidden') notFound();
  return { versions: result.versions };
}
