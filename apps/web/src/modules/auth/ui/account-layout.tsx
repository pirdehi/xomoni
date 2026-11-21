'use client';

import { Skeleton, SkeletonItem, makeStyles, tokens, typographyStyles, mergeClasses } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: '40px',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '1024px',
    margin: '0 auto',
    padding: `40px ${tokens.spacingHorizontalL}`,
    '@media (min-width: 640px)': { padding: `40px ${tokens.spacingHorizontalXXL}` },
  },
  skeleton: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  section: {
    padding: tokens.spacingHorizontalXXL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  sectionTitle: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  sectionText: {
    maxWidth: '672px',
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '384px',
    marginTop: tokens.spacingVerticalXL,
  },
  wide: { maxWidth: '672px' },
});

/** The account page's main column: its sections stacked with room between them. */
export function AccountMain({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <main className={s.main}>{children}</main>;
}

/** Stands in for the account page while the server loads the account (`aria-busy`). */
export function AccountSkeleton() {
  const s = useStyles();
  return (
    <Skeleton className={s.skeleton} aria-busy aria-label="Loading your account">
      <SkeletonItem size={32} />
      <SkeletonItem size={128} />
      <SkeletonItem size={128} />
    </Skeleton>
  );
}

/**
 * One card of the account page: a heading that names the region for screen readers, a line of text and the body.
 * `wide` lets the body use the text's width, for content that isn't a narrow form (a list of apps, a QR code).
 */
export function AccountSection({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const s = useStyles();
  const id = title.toLowerCase().replace(/\W+/g, '-');
  return (
    <section className={s.section} aria-labelledby={id}>
      <h2 id={id} className={s.sectionTitle}>
        {title}
      </h2>
      <p className={s.sectionText}>{description}</p>
      <div className={mergeClasses(s.sectionBody, wide && s.wide)}>{children}</div>
    </section>
  );
}
