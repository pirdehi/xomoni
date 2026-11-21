// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createExtensionSessionServices } from './extension-session';

type Listener = (event: string) => void;
const listeners: Listener[] = [];
const unsubscribe = vi.fn();

vi.mock('@/shared/supabase/browser', () => ({
  createBrowserSupabase: () => ({
    auth: {
      onAuthStateChange: (listener: Listener) => {
        listeners.push(listener);
        return { data: { subscription: { unsubscribe } } };
      },
    },
  }),
}));

describe('onSessionChange: what makes the page sync again', () => {
  it('signing in or out, and a verified two-step code, which finishes a sign-in that owed one (#173)', () => {
    const onChange = vi.fn();
    const stop = createExtensionSessionServices().onSessionChange(onChange);
    const fire = (event: string) => listeners.forEach((listener) => listener(event));

    fire('TOKEN_REFRESHED');
    fire('USER_UPDATED');
    expect(onChange).not.toHaveBeenCalled();

    fire('SIGNED_IN');
    fire('MFA_CHALLENGE_VERIFIED');
    fire('SIGNED_OUT');
    expect(onChange).toHaveBeenCalledTimes(3);

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
