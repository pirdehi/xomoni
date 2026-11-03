'use client';
// The header and footer of every page, on Fluent UI tokens (ADR-0019).
import { makeStyles, tokens } from '@fluentui/react-components';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { GITHUB_URL } from '@/shared/config/site';
import { ButtonLink } from './links';

const useStyles = makeStyles({
  logo: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '-0.01em',
    textDecorationLine: 'none',
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  logoImage: { borderRadius: tokens.borderRadiusMedium },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground3} 85%, transparent)`,
    backdropFilter: 'saturate(180%) blur(12px)',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
    boxSizing: 'border-box',
    maxWidth: '1152px',
    height: '64px',
    margin: '0 auto',
    padding: `0 ${tokens.spacingHorizontalL}`,
    '@media (min-width: 640px)': { padding: `0 ${tokens.spacingHorizontalXXL}` },
  },
  nav: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  // Section links only fit next to the logo on wider screens; GitHub fits from a small tablet up.
  wide: { display: 'none', '@media (min-width: 768px)': { display: 'inline-flex' } },
  medium: { display: 'none', '@media (min-width: 640px)': { display: 'inline-flex' } },
  signIn: { marginLeft: tokens.spacingHorizontalXS },
  footer: {
    marginTop: 'auto',
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  footerBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    boxSizing: 'border-box',
    maxWidth: '1152px',
    margin: '0 auto',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    '@media (min-width: 640px)': {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
    },
  },
  credits: { margin: 0 },
  footerNav: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXL },
  footerLink: {
    color: 'inherit',
    textDecorationLine: 'none',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { color: tokens.colorNeutralForeground1, textDecorationLine: 'underline' },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
});

/** The Xomoni logo, linking home. */
export function Logo() {
  const s = useStyles();
  return (
    <Link href="/" className={s.logo}>
      <Image src="/logo.png" alt="" width={28} height={28} className={s.logoImage} priority />
      <span>Xomoni</span>
    </Link>
  );
}

/** GitHub's mark, one `em` square like Fluent's icons; `className` can size it otherwise. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Sticky, translucent site header; pass `children` to replace the default navigation. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  const s = useStyles();
  return (
    <header className={s.header}>
      <div className={s.bar}>
        <Logo />
        <nav className={s.nav} aria-label="Main">
          {children ?? (
            <>
              <ButtonLink href="/#how" appearance="subtle" className={s.wide}>
                How it works
              </ButtonLink>
              <ButtonLink href="/#safety" appearance="subtle" className={s.wide}>
                Safety
              </ButtonLink>
              <ButtonLink href="/#privacy" appearance="subtle" className={s.wide}>
                Privacy
              </ButtonLink>
              <ButtonLink href={GITHUB_URL} appearance="subtle" className={s.medium}>
                GitHub
              </ButtonLink>
              <ButtonLink href="/login" appearance="primary" className={s.signIn}>
                Sign in
              </ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Site footer: credits and legal links. */
export function SiteFooter() {
  const s = useStyles();
  const link = (href: string, label: string) =>
    href.startsWith('/') ? (
      <Link href={href} className={s.footerLink}>
        {label}
      </Link>
    ) : (
      <a href={href} className={s.footerLink}>
        {label}
      </a>
    );
  return (
    <footer className={s.footer}>
      <div className={s.footerBar}>
        <p className={s.credits}>
          © 2026 {link('https://github.com/pirdehi', 'Omid Pirdehi')} · MIT license · Not affiliated with X Corp.
        </p>
        <nav className={s.footerNav} aria-label="Legal">
          {link('/risks', 'Risks')}
          {link('/privacy', 'Privacy')}
          {link('/terms', 'Terms')}
          {link(GITHUB_URL, 'GitHub')}
        </nav>
      </div>
    </footer>
  );
}
