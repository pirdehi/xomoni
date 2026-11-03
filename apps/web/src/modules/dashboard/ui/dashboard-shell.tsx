'use client';
// The frame of `/dashboard` around the live view: the page column and the skeleton shown while the first snapshot
// loads, on Fluent UI (ADR-0019). Client components, because Fluent's styles are hooks; the route stays a server
// component that passes the streamed content in.
import { Skeleton, SkeletonItem, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  main: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '1024px',
    margin: '0 auto',
    padding: `40px ${tokens.spacingHorizontalL}`,
    '@media (min-width: 640px)': { padding: `40px ${tokens.spacingHorizontalXXL}` },
  },
  skeleton: { display: 'grid', gap: tokens.spacingVerticalXXL },
  bar: { height: '56px', borderRadius: tokens.borderRadius2XLarge },
  tall: { height: '192px', borderRadius: tokens.borderRadius2XLarge },
  medium: { height: '128px', borderRadius: tokens.borderRadius2XLarge },
});

/** The dashboard's page column: centered, as wide as the job cards read well. */
export function DashboardMain({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <main className={s.main}>{children}</main>;
}

/** Placeholder shapes for the account bar and the first sections, announced as loading. */
export function DashboardSkeleton() {
  const s = useStyles();
  return (
    <Skeleton className={s.skeleton} aria-label="Loading your dashboard">
      <SkeletonItem className={s.bar} />
      <SkeletonItem className={s.tall} />
      <SkeletonItem className={s.medium} />
    </Skeleton>
  );
}
