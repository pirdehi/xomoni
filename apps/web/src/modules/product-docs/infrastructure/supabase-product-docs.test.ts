import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseProductDocumentStore, toDocument, toVersion } from './supabase-product-docs';

type Result = { data: unknown; error: { message: string } | null };

/** A scripted client: each call to `from()` records its chain and resolves to the next scripted result. */
function fakeClient(results: Result[], rpcResult: Result = { data: true, error: null }) {
  const calls: [string, unknown[]][][] = [];
  const from = vi.fn((table: string) => {
    const chain: [string, unknown[]][] = [['from', [table]]];
    calls.push(chain);
    const result = results.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'insert']) {
      builder[method] = (...args: unknown[]) => {
        chain.push([method, args]);
        return builder;
      };
    }
    for (const method of ['maybeSingle', 'single']) {
      builder[method] = () => {
        chain.push([method, []]);
        return Promise.resolve(result);
      };
    }
    builder.then = (resolve: (r: Result) => unknown) => resolve(result);
    return builder;
  });
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, calls, rpc };
}

const row = {
  id: 5,
  slug: 'product',
  title: 'Brand engine',
  created_at: '2026-11-28T10:00:00Z',
  html: '<html></html>',
};

describe('mapping', () => {
  it('maps rows to versions and documents', () => {
    expect(toVersion(row)).toEqual({
      id: 5,
      slug: 'product',
      title: 'Brand engine',
      createdAt: '2026-11-28T10:00:00Z',
    });
    expect(toDocument(row)).toEqual({ ...toVersion(row), html: '<html></html>' });
  });
});

describe('createSupabaseProductDocumentStore', () => {
  it('asks the database whether the signed-in person is a super-admin', async () => {
    const yes = fakeClient([]);
    expect(await createSupabaseProductDocumentStore(yes.client).isSuperadmin()).toBe(true);
    expect(yes.rpc).toHaveBeenCalledWith('is_superadmin');
    const no = fakeClient([], { data: false, error: null });
    expect(await createSupabaseProductDocumentStore(no.client).isSuperadmin()).toBe(false);
  });

  it('fails when the check fails', async () => {
    const { client } = fakeClient([], { data: null, error: { message: 'JWT expired' } });
    await expect(createSupabaseProductDocumentStore(client).isSuperadmin()).rejects.toThrow(
      'is_superadmin: JWT expired',
    );
  });

  it('reads the newest version of a document, newest by time then by id', async () => {
    const { client, calls } = fakeClient([{ data: row, error: null }]);
    expect(await createSupabaseProductDocumentStore(client).latest('product')).toMatchObject({
      id: 5,
      html: '<html></html>',
    });
    expect(calls[0]).toEqual([
      ['from', ['product_documents']],
      ['select', ['id, slug, title, created_at, html']],
      ['eq', ['slug', 'product']],
      ['order', ['created_at', { ascending: false }]],
      ['order', ['id', { ascending: false }]],
      ['limit', [1]],
      ['maybeSingle', []],
    ]);
  });

  it('gives null when a document has no version yet or no such version', async () => {
    const { client } = fakeClient([
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const store = createSupabaseProductDocumentStore(client);
    expect(await store.latest('product')).toBeNull();
    expect(await store.byId('product', 9)).toBeNull();
  });

  it('reads one version only within its document', async () => {
    const { client, calls } = fakeClient([{ data: row, error: null }]);
    await createSupabaseProductDocumentStore(client).byId('product', 5);
    expect(calls[0]).toContainEqual(['eq', ['slug', 'product']]);
    expect(calls[0]).toContainEqual(['eq', ['id', 5]]);
  });

  it('lists versions without their pages, newest first, up to the limit', async () => {
    const { client, calls } = fakeClient([{ data: [row], error: null }]);
    const versions = await createSupabaseProductDocumentStore(client).versions('product', 50);
    expect(versions).toEqual([toVersion(row)]);
    expect(calls[0]).toContainEqual(['select', ['id, slug, title, created_at']]);
    expect(calls[0]).toContainEqual(['limit', [50]]);
  });

  it('adds a version without naming its author: the database records the signed-in person', async () => {
    const { client, calls } = fakeClient([{ data: row, error: null }]);
    const version = await createSupabaseProductDocumentStore(client).add({
      slug: 'product',
      title: 'Brand engine',
      html: '<html></html>',
    });
    expect(version).toEqual(toVersion(row));
    expect(calls[0]).toContainEqual(['insert', [{ slug: 'product', title: 'Brand engine', html: '<html></html>' }]]);
    expect(calls[0]).toContainEqual(['single', []]);
  });

  it('turns every failed read or write into an error naming the table', async () => {
    const error = { message: 'new row violates row-level security policy' };
    const { client } = fakeClient([
      { data: null, error },
      { data: null, error },
      { data: null, error },
      { data: null, error },
    ]);
    const store = createSupabaseProductDocumentStore(client);
    await expect(store.latest('product')).rejects.toThrow('product_documents: new row violates');
    await expect(store.byId('product', 1)).rejects.toThrow('product_documents');
    await expect(store.versions('product', 1)).rejects.toThrow('product_documents');
    await expect(store.add({ slug: 'product', title: 't', html: '<html></html>' })).rejects.toThrow(
      'product_documents',
    );
  });
});
