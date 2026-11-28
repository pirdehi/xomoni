import { describe, expect, it, vi } from 'vitest';
import type { ProductDocument } from '../domain/document';
import type { ProductDocumentStore } from './ports';
import { addVersion, listVersions, openDocument, VERSION_LIST_LIMIT } from './product-docs';

const doc = (over: Partial<ProductDocument> = {}): ProductDocument => ({
  id: 7,
  slug: 'product',
  title: 'Brand engine',
  createdAt: '2026-11-28T10:00:00Z',
  html: '<html><body>hi</body></html>',
  ...over,
});

function store(admin: boolean, over: Partial<ProductDocumentStore> = {}): ProductDocumentStore {
  return {
    isSuperadmin: vi.fn(() => Promise.resolve(admin)),
    latest: vi.fn(() => Promise.resolve(doc())),
    byId: vi.fn((_slug: string, id: number) => Promise.resolve(id === 3 ? doc({ id: 3, title: 'Older' }) : null)),
    versions: vi.fn(() => Promise.resolve([doc()])),
    add: vi.fn((input: { slug: string; title: string; html: string }) =>
      Promise.resolve({ id: 8, slug: input.slug, title: input.title, createdAt: '2026-11-28T11:00:00Z' }),
    ),
    ...over,
  };
}

describe('openDocument', () => {
  it('gives a super-admin the newest version', async () => {
    const s = store(true);
    expect(await openDocument(s, 'product')).toEqual({ status: 'ok', document: doc() });
    expect(s.latest).toHaveBeenCalledWith('product');
    expect(s.byId).not.toHaveBeenCalled();
  });

  it('gives a super-admin the version they name', async () => {
    const s = store(true);
    expect(await openDocument(s, 'product', 3)).toMatchObject({ status: 'ok', document: { id: 3, title: 'Older' } });
    expect(s.byId).toHaveBeenCalledWith('product', 3);
  });

  it('says missing when there is no such version, or no version yet', async () => {
    expect(await openDocument(store(true), 'product', 99)).toEqual({ status: 'missing' });
    expect(await openDocument(store(true, { latest: () => Promise.resolve(null) }), 'product')).toEqual({
      status: 'missing',
    });
  });

  it('tells anyone else only that it is forbidden, without reading any document', async () => {
    const s = store(false);
    expect(await openDocument(s, 'product')).toEqual({ status: 'forbidden' });
    expect(await openDocument(s, 'product', 3)).toEqual({ status: 'forbidden' });
    expect(s.latest).not.toHaveBeenCalled();
    expect(s.byId).not.toHaveBeenCalled();
  });

  it('lets a failing store fail the request', async () => {
    const s = store(true, { latest: () => Promise.reject(new Error('product_documents: JWT expired')) });
    await expect(openDocument(s, 'product')).rejects.toThrow('JWT expired');
  });
});

describe('listVersions', () => {
  it('lists up to the limit for a super-admin', async () => {
    const s = store(true);
    expect(await listVersions(s, 'product')).toEqual({ status: 'ok', versions: [doc()] });
    expect(s.versions).toHaveBeenCalledWith('product', VERSION_LIST_LIMIT);
  });

  it('lists nothing for anyone else', async () => {
    const s = store(false);
    expect(await listVersions(s, 'product')).toEqual({ status: 'forbidden' });
    expect(s.versions).not.toHaveBeenCalled();
  });
});

describe('addVersion', () => {
  const page = '<!doctype html><html><body>new</body></html>';

  it('stores a checked version with its title trimmed', async () => {
    const s = store(true);
    const result = await addVersion(s, 'product', { title: '  Version two ', html: page });
    expect(result).toEqual({
      ok: true,
      version: { id: 8, slug: 'product', title: 'Version two', createdAt: '2026-11-28T11:00:00Z' },
    });
    expect(s.add).toHaveBeenCalledWith({ slug: 'product', title: 'Version two', html: page });
  });

  it('refuses a bad document before asking the store anything', async () => {
    const s = store(true);
    expect(await addVersion(s, 'product', { title: 'x', html: 'plain text' })).toEqual({
      ok: false,
      problem: 'not-html',
    });
    expect(await addVersion(s, 'product', { title: ' ', html: page })).toEqual({ ok: false, problem: 'bad-title' });
    expect(s.isSuperadmin).not.toHaveBeenCalled();
    expect(s.add).not.toHaveBeenCalled();
  });

  it('refuses anyone who is not a super-admin without writing', async () => {
    const s = store(false);
    expect(await addVersion(s, 'product', { title: 'x', html: page })).toEqual({ ok: false, problem: 'forbidden' });
    expect(s.add).not.toHaveBeenCalled();
  });

  it('reports a failed write, and a failed check, as failed', async () => {
    expect(
      await addVersion(store(true, { add: () => Promise.reject(new Error('42501')) }), 'product', {
        title: 'x',
        html: page,
      }),
    ).toEqual({ ok: false, problem: 'failed' });
    expect(
      await addVersion(store(true, { isSuperadmin: () => Promise.reject(new Error('down')) }), 'product', {
        title: 'x',
        html: page,
      }),
    ).toEqual({ ok: false, problem: 'failed' });
  });
});
