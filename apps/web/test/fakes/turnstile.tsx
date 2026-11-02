// Stands in for `@marsidev/react-turnstile` in unit tests (aliased in vitest.config.ts): no Cloudflare
// script, and the test decides what the check does. By default it passes at once with TEST_TOKEN.
import { useEffect, useImperativeHandle, type Ref } from 'react';

/** The token the fake check hands out when it passes. */
export const TEST_TOKEN = 'turnstile-test-token';

/** What the next check does: pass, fail, wait for a click, or never answer. */
export type TurnstileOutcome = 'success' | 'error' | 'interactive' | 'silent';

/** Test controls: set `outcome` before rendering; `resets` counts calls to `reset()`. */
export const turnstile = { outcome: 'success' as TurnstileOutcome, resets: 0 };

/** Puts the controls back to a passing check. */
export function resetTurnstile() {
  turnstile.outcome = 'success';
  turnstile.resets = 0;
}

export interface TurnstileInstance {
  reset: () => void;
  remove: () => void;
  getResponse: () => string | undefined;
}

interface Props {
  ref?: Ref<TurnstileInstance>;
  siteKey: string;
  options?: Record<string, unknown>;
  onSuccess?: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  onBeforeInteractive?: () => void;
  onAfterInteractive?: () => void;
}

export function Turnstile({ ref, onSuccess, onError, onBeforeInteractive }: Props) {
  useImperativeHandle(ref, () => ({
    reset: () => {
      turnstile.resets++;
      if (turnstile.outcome === 'success') onSuccess?.(TEST_TOKEN);
    },
    remove: () => undefined,
    getResponse: () => undefined,
  }));
  useEffect(() => {
    if (turnstile.outcome === 'success') onSuccess?.(TEST_TOKEN);
    else if (turnstile.outcome === 'error') onError?.();
    else if (turnstile.outcome === 'interactive') onBeforeInteractive?.();
  }, [onSuccess, onError, onBeforeInteractive]);
  return <div data-testid="turnstile" />;
}
