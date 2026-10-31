'use client';

import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TURNSTILE_SITE_KEY } from '@/shared/config/site';

/** How long to wait for a token before offering to retry the check. */
const SLOW_CHECK_MS = 20_000;

/** One form's captcha: the widget to render, the current token, and ways to get a fresh one. */
export interface Captcha {
  /** The Turnstile widget; it only becomes visible if Cloudflare needs the person to interact. */
  widget: ReactNode;
  /** The current token, or `null` while the check is running, after it expired, or after it failed. */
  token: string | null;
  /** Cloudflare wants the person to tick its box; the check waits for them, so it is not stuck. */
  interactive: boolean;
  /** The check failed (for example Cloudflare could not be reached) or is taking unusually long. */
  stuck: boolean;
  /** Discards the used token and starts a new check. Tokens are single-use, so call it after every submit. */
  reset: () => void;
  /** Retries after a failure: restarts the widget, or reloads the page if Cloudflare's script never loaded. */
  retry: () => void;
}

/**
 * Cloudflare Turnstile for one form. Supabase Auth verifies the token on sign-up, sign-in and password
 * reset requests, which stops scripted sign-ups and password guessing without a puzzle for most people.
 */
export function useCaptcha(action: string): Captcha {
  const ref = useRef<TurnstileInstance>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // While there is no token, flag a check that takes unusually long so the person can retry it. A check that
  // waits for the person's click is not slow.
  useEffect(() => {
    if (token || interactive) return;
    const timer = setTimeout(() => setSlow(true), SLOW_CHECK_MS);
    return () => clearTimeout(timer);
  }, [token, interactive, attempt]);

  const reset = useCallback(() => {
    setToken(null);
    setFailed(false);
    setSlow(false);
    setInteractive(false);
    setAttempt((n) => n + 1);
    ref.current?.reset();
  }, []);

  const retry = useCallback(() => {
    // If Cloudflare's script never loaded, only a fresh page load fetches it again.
    if (!('turnstile' in window)) {
      window.location.reload();
      return;
    }
    reset();
  }, [reset]);

  const widget = (
    <Turnstile
      ref={ref}
      siteKey={TURNSTILE_SITE_KEY}
      options={{ action, theme: 'auto', size: 'flexible', appearance: 'interaction-only' }}
      onSuccess={(value) => {
        setFailed(false);
        setSlow(false);
        setInteractive(false);
        setToken(value);
      }}
      onBeforeInteractive={() => {
        setSlow(false);
        setInteractive(true);
      }}
      onAfterInteractive={() => setInteractive(false)}
      onExpire={() => setToken(null)}
      onError={() => {
        setToken(null);
        setFailed(true);
      }}
    />
  );
  return { widget, token, interactive: !token && interactive, stuck: !token && (failed || slow), reset, retry };
}

/**
 * Explains why the submit button waits: the check is running, Cloudflare wants a click, or the check failed or
 * stalled (with a retry).
 */
export function CaptchaStatus({ captcha }: { captcha: Captcha }) {
  if (captcha.token) return null;
  if (captcha.stuck) {
    return (
      <p className="mt-2 text-center text-xs text-ink-2" role="alert">
        The security check didn’t finish. Check your connection, then{' '}
        <button type="button" onClick={captcha.retry} className="font-medium text-accent underline underline-offset-2">
          try again
        </button>
        .
      </p>
    );
  }
  return (
    <p className="mt-2 text-center text-xs text-muted" role="status">
      {captcha.interactive ? 'Tick the box above to continue.' : 'Running a quick security check…'}
    </p>
  );
}
