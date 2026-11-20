import { describe, expect, it } from 'vitest';
import { isOneClick, stopState, stopToken } from './weekly-email';

const TOKEN = '3f2a6c1e-9b7d-4e8a-a1c2-5d6e7f8091ab';

describe('the weekly email’s stop link (ADR-0031)', () => {
  it('takes only a token Xomoni could have made, lowercased', () => {
    expect(stopToken(TOKEN)).toBe(TOKEN);
    expect(stopToken(` ${TOKEN.toUpperCase()} `)).toBe(TOKEN);
    for (const raw of [null, '', 'abc', `${TOKEN}x`, "' or 1=1 --", TOKEN.replaceAll('-', '')]) {
      expect(stopToken(raw), String(raw)).toBeNull();
    }
  });

  it('knows a mail app’s one-click stop by its body (RFC 8058)', () => {
    expect(isOneClick('List-Unsubscribe=One-Click')).toBe(true);
    expect(isOneClick('')).toBe(false);
    expect(isOneClick('List-Unsubscribe=Yes')).toBe(false);
  });

  it('says what the stop page shows', () => {
    expect(stopState({ token: TOKEN })).toBe('ask');
    expect(stopState({ token: TOKEN, failed: '1' })).toBe('failed');
    expect(stopState({ stopped: '1' })).toBe('stopped');
    expect(stopState({ token: 'nope' })).toBe('invalid');
    expect(stopState({})).toBe('invalid');
  });
});
