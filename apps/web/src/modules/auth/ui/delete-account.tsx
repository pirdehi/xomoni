'use client';

import { useState, useTransition } from 'react';
import { Trash } from 'lucide-react';
import { deleteAccount } from '../server/actions';

/** The "Delete account" section: asks the person to type DELETE, then removes the Xomoni account. */
export function DeleteAccountSection() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    const typed = prompt(
      'This deletes your Xomoni account: connected browsers and job history on this site. Nothing on X is deleted, and the extension keeps working offline.\n\nType DELETE to confirm.',
    );
    if (typed !== 'DELETE') return;
    startTransition(async () => {
      const result = await deleteAccount();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <section className="border-t border-line pt-8" aria-labelledby="danger-title">
      <h2 id="danger-title" className="font-semibold">
        Delete account
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">
        Removes your Xomoni account, connected browsers and job history from our servers. Your X account and
        everything stored in the extension stay as they are.
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
    </section>
  );
}
