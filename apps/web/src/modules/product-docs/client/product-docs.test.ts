import { describe, expect, it, vi } from 'vitest';
import { createBrowserSupabase } from '@/shared/supabase/browser';
import { browserProductDocs } from './product-docs';

vi.mock('@/shared/supabase/browser', () => ({ createBrowserSupabase: vi.fn() }));

describe('browserProductDocs', () => {
  it('adds a version of the product document straight to Supabase as the signed-in person', async () => {
    const single = vi.fn(() =>
      Promise.resolve({
        data: { id: 3, slug: 'product', title: 'Brand engine', created_at: '2026-11-28T10:00:00Z' },
        error: null,
      }),
    );
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    vi.mocked(createBrowserSupabase).mockReturnValue({
      rpc: () => Promise.resolve({ data: true, error: null }),
      from: () => ({ insert }),
    } as never);

    const result = await browserProductDocs.addVersion({ title: 'Brand engine', html: '<html><body>x</body></html>' });

    expect(result).toEqual({
      ok: true,
      version: { id: 3, slug: 'product', title: 'Brand engine', createdAt: '2026-11-28T10:00:00Z' },
    });
    expect(insert).toHaveBeenCalledWith({
      slug: 'product',
      title: 'Brand engine',
      html: '<html><body>x</body></html>',
    });
  });
});
