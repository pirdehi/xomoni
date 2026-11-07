import { describe, expect, it, vi } from 'vitest';

type Listener = (event: string, session: { user: { email?: string } } | null) => void;
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
    const seen: (string | null)[] = [];

    const stop = watchSessionEmail((email) => seen.push(email));
    listener('INITIAL_SESSION', { user: { email: 'ada@example.com' } });
    listener('SIGNED_OUT', null);
    listener('SIGNED_IN', { user: {} });
    stop();

    expect(seen).toEqual(['ada@example.com', null, '']);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
