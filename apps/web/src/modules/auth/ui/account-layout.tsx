'use client';

import { Skeleton, SkeletonItem, makeStyles, tokens } from '@fluentui/react-components';
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
