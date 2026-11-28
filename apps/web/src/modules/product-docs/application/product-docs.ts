import { checkDocument, type AddProblem, type ProductDocument, type ProductDocumentVersion } from '../domain/document';
import type { ProductDocumentStore } from './ports';

/** How many versions the manage page lists. */
export const VERSION_LIST_LIMIT = 50;

/** What opening a document found: not for this person, nothing stored yet, or the document. */
export type OpenResult =
  | { readonly status: 'forbidden' }
  | { readonly status: 'missing' }
  | { readonly status: 'ok'; readonly document: ProductDocument };

/**
 * Opens a document for the signed-in person: its newest version, or the version `versionId` names. Anyone who isn't a
 * super-admin gets `forbidden`, whatever exists, so the answer reveals nothing to them.
 */
export async function openDocument(
  store: ProductDocumentStore,
  slug: string,
  versionId?: number | null,
): Promise<OpenResult> {
  if (!(await store.isSuperadmin())) return { status: 'forbidden' };
  const document = versionId == null ? await store.latest(slug) : await store.byId(slug, versionId);
  return document ? { status: 'ok', document } : { status: 'missing' };
}

/** A document's versions for the manage page, newest first; `forbidden` for anyone who isn't a super-admin. */
export async function listVersions(
  store: ProductDocumentStore,
  slug: string,
): Promise<{ readonly status: 'forbidden' } | { readonly status: 'ok'; readonly versions: ProductDocumentVersion[] }> {
  if (!(await store.isSuperadmin())) return { status: 'forbidden' };
  return { status: 'ok', versions: await store.versions(slug, VERSION_LIST_LIMIT) };
}

/** What adding a version did. */
export type AddResult =
  | { readonly ok: true; readonly version: ProductDocumentVersion }
  | { readonly ok: false; readonly problem: AddProblem };

/**
 * Adds a version of a document: checked first ({@link checkDocument}), then stored as the signed-in super-admin.
 * Anyone else gets `forbidden` without a write; a store that fails gets `failed`.
 */
export async function addVersion(
  store: ProductDocumentStore,
  slug: string,
  input: { readonly title: string; readonly html: string },
): Promise<AddResult> {
  const problem = checkDocument(input);
  if (problem) return { ok: false, problem };
  try {
    if (!(await store.isSuperadmin())) return { ok: false, problem: 'forbidden' };
    const version = await store.add({ slug, title: input.title.trim(), html: input.html });
    return { ok: true, version };
  } catch {
    return { ok: false, problem: 'failed' };
  }
}
