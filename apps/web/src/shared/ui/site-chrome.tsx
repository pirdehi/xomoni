import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { GITHUB_URL } from '@/shared/config/site';

/** The Xomoni logo, linking home. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight">
      <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md" priority />
      <span>Xomoni</span>
    </Link>
  );
}

/** GitHub's mark, sized by `className`. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Sticky site header; pass `children` to replace the default navigation. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-page/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          {children ?? (
            <>
              <Link href="/#how" className="hidden rounded-md px-3 py-2 text-ink-2 hover:text-ink md:block">
                How it works
              </Link>
              <Link href="/#safety" className="hidden rounded-md px-3 py-2 text-ink-2 hover:text-ink md:block">
                Safety
              </Link>
              <Link href="/#privacy" className="hidden rounded-md px-3 py-2 text-ink-2 hover:text-ink md:block">
                Privacy
              </Link>
              <a href={GITHUB_URL} className="hidden rounded-md px-3 py-2 text-ink-2 hover:text-ink sm:block">
                GitHub
              </a>
              <Link href="/login" className="btn btn-primary ml-1 py-2">
                Sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Site footer: credits and legal links. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          © 2026{' '}
          <a href="https://github.com/pirdehi" className="hover:text-ink">
            Omid Pirdehi
          </a>{' '}
          · MIT license · Not affiliated with X Corp.
        </p>
        <nav className="flex gap-5">
          <Link href="/risks" className="hover:text-ink">
            Risks
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <a href={GITHUB_URL} className="hover:text-ink">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
