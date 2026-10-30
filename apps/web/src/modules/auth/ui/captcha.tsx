'use client';

import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { TURNSTILE_SITE_KEY } from '@/shared/config/site';

/** One form's captcha: the widget to render, the current token, and a way to get a fresh token. */
export interface Captcha {
  /** The Turnstile widget; it only becomes visible if Cloudflare needs the person to interact. */
  widget: ReactNode;
  /** The current token, or `null` while the check is running or after it expired. */
  token: string | null;
  /** Discards the used token and starts a new check. Tokens are single-use, so call it after every submit. */
  reset: () => void;
}

/**
 * Cloudflare Turnstile for one form. Supabase Auth verifies the token on sign-up, sign-in and password
 * reset requests, which stops scripted sign-ups and password guessing without a puzzle for most people.
 */
export function useCaptcha(action: string): Captcha {
  const ref = useRef<TurnstileInstance>(null);
  const [token, setToken] = useState<string | null>(null);
  const reset = useCallback(() => {
    setToken(null);
    ref.current?.reset();
  }, []);

  const widget = (
    <Turnstile
      ref={ref}
      siteKey={TURNSTILE_SITE_KEY}
      options={{ action, theme: 'auto', size: 'flexible', appearance: 'interaction-only' }}
      onSuccess={setToken}
      onExpire={() => setToken(null)}
      onError={() => setToken(null)}
    />
  );
  return { widget, token, reset };
}

/** Explains why the submit button waits while the captcha check runs. */
export function CaptchaStatus({ captcha }: { captcha: Captcha }) {
  if (captcha.token) return null;
  return (
    <p className="mt-2 text-center text-xs text-muted" role="status">
      Running a quick security check…
    </p>
  );
}
