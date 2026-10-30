'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { FormAlert } from './form-alert';

/** "Continue with Google": starts the OAuth flow from the browser and keeps `?next=` for the return trip. */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const next = useSearchParams().get('next');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function signIn() {
    setError(null);
    startTransition(async () => {
      const result = await browserAuth.startGoogleSignIn(next);
      if (result.ok) window.location.assign(result.url);
      else setError(AUTH_ERROR_MESSAGES[result.code]);
    });
  }

  return (
    <>
      <button type="button" onClick={signIn} disabled={pending} className="btn btn-secondary w-full py-3 text-base">
        {pending ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <GoogleMark />}
        {label}
      </button>
      {error && <FormAlert message={error} />}
    </>
  );
}

/** Shows the error that `/auth/callback` passed back in `?error=`. */
export function CallbackError() {
  const message = useSearchParams().get('error');
  return message ? <FormAlert message={message} /> : null;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
