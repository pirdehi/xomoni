'use client';

import { Divider, Skeleton, SkeletonItem, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/shared/ui/site-chrome';

const useStyles = makeStyles({
  main: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `56px ${tokens.spacingHorizontalL}`,
    backgroundImage: `radial-gradient(60% 45% at 50% 0%, ${tokens.colorBrandBackground2} 0%, transparent 100%)`,
  },
  column: { width: '100%', maxWidth: '400px' },
  logo: { display: 'flex', justifyContent: 'center' },
  card: {
    boxSizing: 'border-box',
    marginTop: tokens.spacingVerticalXXL,
    padding: tokens.spacingHorizontalXXL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    '@media (min-width: 640px)': { padding: '32px' },
  },
  title: { ...typographyStyles.title3, margin: 0, color: tokens.colorNeutralForeground1 },
  description: {
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  body: { marginTop: tokens.spacingVerticalXXL },
  footer: {
    margin: `${tokens.spacingVerticalXXL} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    textAlign: 'center',
  },
  divider: { margin: `${tokens.spacingVerticalXXL} 0`, color: tokens.colorNeutralForeground3 },
  legal: {
    margin: `${tokens.spacingVerticalXXL} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  legalLink: {
    color: 'inherit',
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
    ':hover': { color: tokens.colorNeutralForeground1 },
  },
  link: {
    color: tokens.colorBrandForegroundLink,
    fontWeight: tokens.fontWeightSemibold,
    textDecorationLine: 'none',
    textUnderlineOffset: '2px',
    ':hover': { color: tokens.colorBrandForegroundLinkHover, textDecorationLine: 'underline' },
  },
  skeleton: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

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
  const s = useStyles();
  return (
    <main className={s.main}>
      <div className={s.column}>
        <div className={s.logo}>
          <Logo />
        </div>
        <div className={s.card}>
          <h1 className={s.title}>{title}</h1>
          {description && <p className={s.description}>{description}</p>}
          <div className={s.body}>{children}</div>
        </div>
        {footer && <p className={s.footer}>{footer}</p>}
      </div>
    </main>
  );
}

/** A horizontal rule with "or" in the middle, between the password form and Google. */
export function OrDivider() {
  const s = useStyles();
  return <Divider className={s.divider}>or</Divider>;
}

/** States what this account is (not an X account) and links the terms and privacy policy. */
export function AuthLegalNote() {
  const s = useStyles();
  return (
    <p className={s.legal}>
      This is your Xomoni account, not your X account. Xomoni never asks for your X password. By continuing you agree to
      the{' '}
      <Link href="/terms" className={s.legalLink}>
        Terms
      </Link>{' '}
      and{' '}
      <Link href="/privacy" className={s.legalLink}>
        Privacy Policy
      </Link>
      .
    </p>
  );
}

/** A link styled for auth pages. */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <Link href={href} className={s.link}>
      {children}
    </Link>
  );
}

/** Stands in for a form while the page loads what it needs on the server (`aria-busy`). */
export function FormSkeleton() {
  const s = useStyles();
  return (
    <Skeleton className={s.skeleton} aria-busy aria-label="Loading">
      <SkeletonItem size={16} />
      <SkeletonItem size={40} />
      <SkeletonItem size={40} />
    </Skeleton>
  );
}
