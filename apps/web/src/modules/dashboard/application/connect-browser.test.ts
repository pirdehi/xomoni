import { describe, expect, it, vi } from 'vitest';
import { PAIR_MESSAGE, type PairMessage } from '../domain/connect';
import type { PairingResult } from '../domain/pairing';
import { connectBrowser } from './connect-browser';

const REQUEST = { extensionId: 'abcdefghijklmnopabcdefghijklmnop', nonce: 'AbCdEfGhIjKlMnOpQrStUv' };
const CODE: PairingResult = { ok: true, code: { code: 'AB2CD-EF3GH', expiresAt: '2026-11-15T12:10:00Z' } };

function deps(code: PairingResult, send: (id: string, message: PairMessage) => Promise<unknown>) {
  return {
    pairing: { createCode: vi.fn(() => Promise.resolve(code)) },
    link: { send: vi.fn(send) },
  };
}

describe('connectBrowser (#228)', () => {
  it('makes a code and hands it to the extension that asked, with its nonce', async () => {
    const d = deps(CODE, () => Promise.resolve({ ok: true, account: 'o•••@example.com' }));

    expect(await connectBrowser(d, REQUEST)).toEqual({ ok: true, account: 'o•••@example.com' });
    expect(d.link.send).toHaveBeenCalledWith(REQUEST.extensionId, {
      type: PAIR_MESSAGE,
      code: 'AB2CD-EF3GH',
      nonce: REQUEST.nonce,
    });
  });

  it('passes on why the extension refused', async () => {
    const d = deps(CODE, () => Promise.resolve({ ok: false, reason: 'already_connected' }));
    expect(await connectBrowser(d, REQUEST)).toEqual({ ok: false, reason: 'already_connected' });
  });

  it('says unreachable when the extension can’t be reached', async () => {
    const d = deps(CODE, () => Promise.reject(new Error('Could not establish connection.')));
    expect(await connectBrowser(d, REQUEST)).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('keeps the database’s message when no code could be made, and sends nothing', async () => {
    const d = deps({ ok: false, message: 'Sign in again.' }, () => Promise.resolve({ ok: true }));

    expect(await connectBrowser(d, REQUEST)).toEqual({ ok: false, reason: 'code', message: 'Sign in again.' });
    expect(d.link.send).not.toHaveBeenCalled();
  });
});
