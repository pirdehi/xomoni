import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ProductDocumentRow } from '@xomoni/db';
import type { ProductDocumentStore } from '../application/ports';
import type { ProductDocument, ProductDocumentVersion } from '../domain/document';

type Client = SupabaseClient<Database>;

const VERSION_COLUMNS = 'id, slug, title, created_at';
const DOCUMENT_COLUMNS = `${VERSION_COLUMNS}, html`;

/** Maps a `public.product_documents` row without its page to a version. */
export function toVersion(
  row: Pick<ProductDocumentRow, 'id' | 'slug' | 'title' | 'created_at'>,
): ProductDocumentVersion {
  return { id: row.id, slug: row.slug, title: row.title, createdAt: row.created_at };
}

/** Maps a whole `public.product_documents` row to a document. */
export function toDocument(
  row: Pick<ProductDocumentRow, 'id' | 'slug' | 'title' | 'created_at' | 'html'>,
): ProductDocument {
  return { ...toVersion(row), html: row.html };
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/**
 * The product documents in Supabase (`public.product_documents`, ADR-0048), read and written as the signed-in person:
 * Row Level Security lets only a super-admin through, and only to read and add. It never filters by a user id.
 */
export function createSupabaseProductDocumentStore(supabase: Client): ProductDocumentStore {
  return {
    async isSuperadmin() {
      const { data, error } = await supabase.rpc('is_superadmin');
      if (error) fail('is_superadmin', error);
      return data;
    },
    async latest(slug) {
      const { data, error } = await supabase
        .from('product_documents')
        .select(DOCUMENT_COLUMNS)
        .eq('slug', slug)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail('product_documents', error);
      return data ? toDocument(data) : null;
    },
    async byId(slug, id) {
      const { data, error } = await supabase
        .from('product_documents')
        .select(DOCUMENT_COLUMNS)
        .eq('slug', slug)
        .eq('id', id)
        .maybeSingle();
      if (error) fail('product_documents', error);
      return data ? toDocument(data) : null;
    },
    async versions(slug, limit) {
      const { data, error } = await supabase
        .from('product_documents')
        .select(VERSION_COLUMNS)
        .eq('slug', slug)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (error) fail('product_documents', error);
      return data.map(toVersion);
    },
    async add(input) {
      const { data, error } = await supabase
        .from('product_documents')
        .insert({ slug: input.slug, title: input.title, html: input.html })
        .select(VERSION_COLUMNS)
        .single();
      if (error) fail('product_documents', error);
      return toVersion(data);
    },
  };
}
