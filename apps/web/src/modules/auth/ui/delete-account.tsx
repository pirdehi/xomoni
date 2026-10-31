'use client';

import { useState, useTransition } from 'react';
import { Trash } from 'lucide-react';
import { ROUTES } from '../domain/routes';
import { deleteAccount } from '../server/actions';

/** Signs out, then opens the sign-in page, which returns to the account page afterwards. */
const SIGN_IN_AGAIN = `${ROUTES.signOut}?next=${encodeURIComponent(`${ROUTES.signIn}?next=${ROUTES.account}`)}`;

/**
 * The "Delete account" section: asks the person to type DELETE, then removes the Xomoni account. If the last
 * sign-in is older than 10 minutes, the database refuses (#80) and the section offers to sign in again.
 */
export function DeleteAccountSection() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);

  function onDelete() {
    const typed = prompt(
      'This deletes your Xomoni account: connected browsers and job history on this site. Nothing on X is deleted, and the extension keeps working offline.\n\nType DELETE to confirm.',
    );
    if (typed !== 'DELETE') return;
    startTransition(async () => {
      const result = await deleteAccount();
      if (result?.error) setError(result.error);
      setReauthenticate(!!result?.reauthenticate);
    });
  }

  return (
    <section className="border-t border-line pt-8" aria-labelledby="danger-title">
      <h2 id="danger-title" className="font-semibold">
        Delete account
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">
        Removes your Xomoni account, connected browsers and job history from our servers. Your X account and everything
        stored in the extension stay as they are.
      </p>
      <button type="button" onClick={onDelete} disabled={pending} className="btn btn-danger mt-4 py-2">
        <Trash className="size-4" aria-hidden />
        {pending ? 'Deleting…' : 'Delete my Xomoni account'}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
      {reauthenticate && (
        <form action={SIGN_IN_AGAIN} method="post" className="mt-3">
          <button type="submit" className="btn btn-secondary py-2">
            Sign in again
          </button>
        </form>
      )}
    </section>
  );
}
