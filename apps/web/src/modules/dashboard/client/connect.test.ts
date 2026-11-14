import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSupabase } from '@/shared/supabase/browser';
import { PAIR_MESSAGE } from '../domain/connect';
import { createConnectServices } from './connect';

vi.mock('@/shared/supabase/browser', () => ({ createBrowserSupabase: vi.fn() }));

const REQUEST = { extensionId: 'abcdefghijklmnopabcdefghijklmnop', nonce: 'AbCdEfGhIjKlMnOpQrStUv' };
let rpc: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpc = vi.fn(() =>
    Promise.resolve({ data: [{ code: 'AB2CD-EF3GH', expires_at: '2026-11-15T12:10:00Z' }], error: null }),
  );
  vi.mocked(createBrowserSupabase)
    .mockReset()
    .mockReturnValue({ rpc } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe('createConnectServices (browser composition root, #228)', () => {
  it('makes the code with the browser client and hands it over through chrome.runtime', async () => {
    const sendMessage = vi.fn((_id: string, _message: unknown, callback: (answer: unknown) => void) =>
      callback({ ok: true, account: 'o•••@example.com' }),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    expect(await createConnectServices().connect(REQUEST)).toEqual({ ok: true, account: 'o•••@example.com' });
    expect(rpc).toHaveBeenCalledWith('create_pairing_code');
    expect(sendMessage).toHaveBeenCalledWith(
      REQUEST.extensionId,
      { type: PAIR_MESSAGE, code: 'AB2CD-EF3GH', nonce: REQUEST.nonce },
      expect.any(Function),
    );
  });

  it('says unreachable in a browser where no extension lists the site', async () => {
    expect(await createConnectServices().connect(REQUEST)).toEqual({ ok: false, reason: 'unreachable' });
  });
});
