import { createBrowserSupabase } from '@/shared/supabase/browser';
import { addVersion } from '../application/product-docs';
import { PRODUCT_DOCUMENT_SLUG } from '../domain/document';
import { createSupabaseProductDocumentStore } from '../infrastructure/supabase-product-docs';

/**
 * Browser composition root for the manage page. A new version goes from the super-admin's browser straight to
 * Supabase, where Row Level Security checks again that they are a super-admin (ADR-0048).
 */
export const browserProductDocs = {
  /** Adds a version of the product document. */
  addVersion: (input: { readonly title: string; readonly html: string }) =>
    addVersion(createSupabaseProductDocumentStore(createBrowserSupabase()), PRODUCT_DOCUMENT_SLUG, input),
};
