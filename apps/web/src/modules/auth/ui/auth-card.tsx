import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/shared/ui/site-chrome';

/** The centered card every auth page uses: logo, title, optional description, content and a footer line. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="card mt-8 p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-2 text-sm leading-relaxed text-ink-2">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <p className="mt-6 text-center text-sm text-muted">{footer}</p>}
      </div>
    </main>
  );
}

/** A horizontal rule with "or" in the middle, between the password form and Google. */
export function OrDivider() {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** States what this account is (not an X account) and links the terms and privacy policy. */
export function AuthLegalNote() {
  return (
    <p className="mt-6 text-xs leading-relaxed text-muted">
      This is your Xomoni account, not your X account. Xomoni never asks for your X password. By continuing you agree to
      the{' '}
      <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
        Terms
      </Link>{' '}
      and{' '}
      <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
        Privacy Policy
      </Link>
      .
    </p>
  );
}

/** A link styled for auth pages. */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
