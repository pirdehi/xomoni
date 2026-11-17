import { describe, expect, it, vi } from 'vitest';

type Listener = (
  event: string,
  session: { user: { email?: string; user_metadata?: Record<string, unknown> } } | null,
) => void;
const auth = vi.hoisted(() => ({
  onAuthStateChange: vi.fn<(listener: Listener) => { data: { subscription: { unsubscribe: () => void } } }>(),
}));
vi.mock('./browser', () => ({ createBrowserSupabase: () => ({ auth }) }));

const { watchSessionEmail } = await import('./browser-session');

describe('watchSessionEmail', () => {
  it('passes on the email of the session, null once signed out, and stops when asked', () => {
    const unsubscribe = vi.fn();
    let listener: Listener = () => undefined;
    auth.onAuthStateChange.mockImplementation((l) => {
      listener = l;
      return { data: { subscription: { unsubscribe } } };
    });
    const seen: [string | null, string][] = [];

    const stop = watchSessionEmail((email, name) => seen.push([email, name ?? '']));
    listener('INITIAL_SESSION', { user: { email: 'ada@example.com', user_metadata: { full_name: ' Ada Lovelace ' } } });
    listener('SIGNED_OUT', null);
    listener('SIGNED_IN', { user: {} });
    listener('TOKEN_REFRESHED', { user: { email: 'g@example.com', user_metadata: { full_name: '', name: 'Grace' } } });
    stop();

    expect(seen).toEqual([
      ['ada@example.com', 'Ada Lovelace'],
      [null, ''],
      ['', ''],
      ['g@example.com', 'Grace'],
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
