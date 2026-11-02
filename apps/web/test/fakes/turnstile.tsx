// Stands in for `@marsidev/react-turnstile` in unit tests (aliased in vitest.config.ts): no Cloudflare
// script, and the test decides what the check does. By default it passes at once with TEST_TOKEN.
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

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

/** Like the real widget, it keeps the latest callbacks in a ref and runs the check once, when it mounts. */
export function Turnstile({ ref, onSuccess, onError, onBeforeInteractive }: Props) {
  const callbacks = useRef({ onSuccess, onError, onBeforeInteractive });
  useEffect(() => {
    callbacks.current = { onSuccess, onError, onBeforeInteractive };
  });
  useImperativeHandle(ref, () => ({
    reset: () => {
      turnstile.resets++;
      if (turnstile.outcome === 'success') callbacks.current.onSuccess?.(TEST_TOKEN);
    },
    remove: () => undefined,
    getResponse: () => undefined,
  }));
  useEffect(() => {
    const { onSuccess: success, onError: error, onBeforeInteractive: interactive } = callbacks.current;
    if (turnstile.outcome === 'success') success?.(TEST_TOKEN);
    else if (turnstile.outcome === 'error') error?.();
    else if (turnstile.outcome === 'interactive') interactive?.();
  }, []);
  return <div data-testid="turnstile" />;
}
