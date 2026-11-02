'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import { AuthCard, AuthLink } from './auth-card';
import { SubmitButton } from './fields';
import { FormAlert } from './form-alert';
import { useSignedInNavigation } from './navigation';

/** What the confirmation page says for each kind of email link Supabase sends. */
interface Copy {
  title: string;
  description: string;
  action: string;
}

const COPY = {
  email: {
    title: 'Confirm your email address',
    description: 'One more click and your Xomoni account is ready.',
    action: 'Confirm and continue',
  },
  signup: {
    title: 'Confirm your email address',
    description: 'One more click and your Xomoni account is ready.',
    action: 'Confirm and continue',
  },
  recovery: {
    title: 'Reset your password',
    description: 'Continue to choose a new password for your Xomoni account.',
    action: 'Continue',
  },
  email_change: {
    title: 'Confirm the email change',
    description: 'Confirm this address for your Xomoni account.',
    action: 'Confirm',
  },
} satisfies Record<string, Copy>;

/** Whether `type` is a kind of link this page has its own copy for. */
const isKnownType = (type: string | null): type is keyof typeof COPY => !!type && Object.hasOwn(COPY, type);

/** The copy for a link's `type`, or the generic one for a type this page doesn't know. */
function copyFor(type: string | null): Copy {
  return isKnownType(type) ? COPY[type] : COPY.email;
}

/**
 * The page behind every link Xomoni emails. It verifies the link only when the person clicks, because
 * mail scanners open links on their own and would otherwise use up the one-time token.
 */
export function ConfirmEmailLink() {
  const params = useSearchParams();
  const query = { token_hash: params.get('token_hash'), type: params.get('type'), next: params.get('next') };
  const copy = copyFor(query.type);
  const navigate = useSignedInNavigation();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    startTransition(async () => {
      const result = await browserAuth.confirmEmailLink(query);
      if (result.ok) navigate(result.next);
      else setError(AUTH_ERROR_MESSAGES[result.code]);
    });
  }

  return (
    <AuthCard
      title={copy.title}
      description={copy.description}
      footer={
        <>
          Link not working? <AuthLink href={ROUTES.signIn}>Sign in</AuthLink> or{' '}
          <AuthLink href={ROUTES.forgotPassword}>reset your password</AuthLink>.
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <SubmitButton pending={pending} disabled={!!error}>
          {copy.action}
        </SubmitButton>
      </form>
      {error && <FormAlert message={error} />}
    </AuthCard>
  );
}
