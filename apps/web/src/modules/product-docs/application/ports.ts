import type { ProductDocument, ProductDocumentVersion } from '../domain/document';

/**
 * Where product documents are kept (ADR-0048). Every call runs as the signed-in person, so the database's Row Level
 * Security decides what they may read or add; the use cases ask {@link ProductDocumentStore.isSuperadmin} first only to
 * tell a stranger from an empty document. Calls throw when the store can't answer.
 */
export interface ProductDocumentStore {
  /** Whether the signed-in person is a super-admin. */
  isSuperadmin(): Promise<boolean>;
  /** The newest version of a document, or null when it has none. */
  latest(slug: string): Promise<ProductDocument | null>;
  /** One version of a document, or null when that document has no version with this id. */
  byId(slug: string, id: number): Promise<ProductDocument | null>;
  /** A document's versions, newest first, at most `limit`. */
  versions(slug: string, limit: number): Promise<ProductDocumentVersion[]>;
  /** Stores a new version and returns it. */
  add(input: { readonly slug: string; readonly title: string; readonly html: string }): Promise<ProductDocumentVersion>;
}
