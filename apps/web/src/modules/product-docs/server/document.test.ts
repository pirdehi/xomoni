import { describe, expect, it, vi } from 'vitest';
import { redirectOf } from '@test/server-helpers';
import { NavigationThrow } from '@test/fakes/navigation';
import { createServerSupabase } from '@/shared/supabase/server';
import type { ProductDocumentStore } from '../application/ports';
import { LINK_SCRIPT, MANAGE_LINK } from '../domain/document';
import { handleProductDocument, loadManageView, versionParam, type ProductDocsDeps } from './document';

vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('@/modules/auth/server/session', () => ({ requireViewer: vi.fn() }));

const page = '<!doctype html><html><body><h1>Brand engine</h1></body></html>';

function store(admin: boolean, over: Partial<ProductDocumentStore> = {}): ProductDocumentStore {
  return {
    isSuperadmin: () => Promise.resolve(admin),
    latest: () =>
      Promise.resolve({ id: 2, slug: 'product', title: 'New', createdAt: '2026-11-28T10:00:00Z', html: page }),
    byId: (_slug, id) =>
      Promise.resolve(
        id === 1
          ? { id: 1, slug: 'product', title: 'Old', createdAt: '2026-11-27T10:00:00Z', html: '<body>old</body>' }
          : null,
      ),
    versions: () => Promise.resolve([{ id: 2, slug: 'product', title: 'New', createdAt: '2026-11-28T10:00:00Z' }]),
    add: () => Promise.reject(new Error('not used')),
    ...over,
  };
}

function deps(
  admin: boolean,
  over: Partial<ProductDocumentStore> = {},
): ProductDocsDeps & { signedIn: ReturnType<typeof vi.fn> } {
  const s = store(admin, over);
  return { signedIn: vi.fn(() => Promise.resolve({ id: 'u1' })), store: () => Promise.resolve(s) };
}

const get = (query = '') => new Request(`https://xomoni.com/product/document${query}`);

describe('versionParam', () => {
  it('reads a positive whole number, nothing, or anything else as invalid', () => {
    expect(versionParam('https://xomoni.com/product/document')).toBeNull();
    expect(versionParam('https://xomoni.com/product/document?v=12')).toBe(12);
    for (const bad of ['0', '-1', '1.5', 'abc', '', '01', '1e3', '9'.repeat(16)]) {
      expect(versionParam(`https://xomoni.com/product/document?v=${bad}`)).toBe('invalid');
    }
  });
});

describe('handleProductDocument', () => {
  it('serves a super-admin the newest version, private, unindexed, with the versions link and link script', async () => {
    const d = deps(true);
    const response = await handleProductDocument(get(), d);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const body = await response.text();
    expect(body).toContain('<h1>Brand engine</h1>');
    expect(body).toContain(MANAGE_LINK);
    expect(body).toContain(LINK_SCRIPT);
    expect(d.signedIn).toHaveBeenCalledWith('/product/document');
  });

  it('serves the version ?v= names, and returns to it after signing in', async () => {
    const d = deps(true);
    const response = await handleProductDocument(get('?v=1'), d);
    expect(await response.text()).toContain('old');
    expect(d.signedIn).toHaveBeenCalledWith('/product/document?v=1');
  });

  it('answers anyone signed in who is not a super-admin with a plain 404, whatever exists', async () => {
    for (const query of ['', '?v=1', '?v=abc']) {
      const response = await handleProductDocument(get(query), deps(false));
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toContain('This page could not be found.');
      expect(body).not.toContain('Brand engine');
      expect(body).not.toContain('version');
    }
  });

  it('tells a super-admin when there is no document yet, or no such version', async () => {
    const empty = await handleProductDocument(get(), deps(true, { latest: () => Promise.resolve(null) }));
    expect(empty.status).toBe(200);
    expect(await empty.text()).toContain('Upload the first version');
    const unknown = await handleProductDocument(get('?v=9'), deps(true));
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain('No version with that number.');
    const invalid = await handleProductDocument(get('?v=abc'), deps(true));
    expect(invalid.status).toBe(404);
    expect(await invalid.text()).toContain('No version with that number.');
  });

  it('sends a signed-out visitor to sign in before touching the store', async () => {
    const storeFn = vi.fn();
    const signedIn = vi.fn(() => Promise.reject(new NavigationThrow('/product/login?next=%2Fproduct%2Fdocument')));
    expect(await redirectOf(handleProductDocument(get(), { signedIn, store: storeFn }))).toBe(
      '/product/login?next=%2Fproduct%2Fdocument',
    );
    expect(storeFn).not.toHaveBeenCalled();
  });

  it('builds its store on the request-bound Supabase client by default', async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: false, error: null }));
    vi.mocked(createServerSupabase).mockResolvedValue({ rpc } as never);
    const response = await handleProductDocument(get());
    expect(response.status).toBe(404);
    expect(rpc).toHaveBeenCalledWith('is_superadmin');
  });
});

describe('loadManageView', () => {
  it('gives a super-admin the versions', async () => {
    const d = deps(true);
    expect(await loadManageView(d)).toEqual({
      versions: [{ id: 2, slug: 'product', title: 'New', createdAt: '2026-11-28T10:00:00Z' }],
    });
    expect(d.signedIn).toHaveBeenCalledWith('/product/documents');
  });

  it('gives anyone else the site’s 404', async () => {
    await expect(loadManageView(deps(false))).rejects.toBeInstanceOf(NavigationThrow);
  });
});
