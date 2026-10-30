import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Logo } from '@/components/site-chrome';
import { CallbackError, GoogleButton } from './google-button';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="card mt-8 p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Xomoni</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Use the same Google account here and in the extension to follow your cleanup from any device.
          </p>
          <div className="mt-6">
            <GoogleButton />
            <Suspense>
              <CallbackError />
            </Suspense>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-muted">
            This is your Xomoni account, not your X account. Xomoni never asks for your X password. By continuing you
            agree to the{' '}
            <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          An account is optional. The extension works without one.
        </p>
      </div>
    </main>
  );
}
