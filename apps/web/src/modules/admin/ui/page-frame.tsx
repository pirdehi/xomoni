'use client';

import {
  Badge,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  makeStyles,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { BADGE_LABELS, type UserBadge } from '../domain/users';

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXL, maxWidth: '1200px' },
  head: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  title: { ...typographyStyles.title2, margin: 0, color: tokens.colorNeutralForeground1, overflowWrap: 'anywhere' },
  description: { margin: 0, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase300 },
  skeleton: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, maxWidth: '1200px' },
  badges: { display: 'inline-flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXS },
});

/** One console page: its title, an optional line under it, and its content. */
export function ConsolePage({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const s = useStyles();
  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>{title}</h1>
        {description && <div className={s.description}>{description}</div>}
      </div>
      {children}
    </div>
  );
}

/** Says the database couldn't give a page's data; reloading tries again. */
export function LoadFailed({ what }: { what: string }) {
  return (
    <MessageBar intent="error" role="alert" aria-labelledby={undefined}>
      <MessageBarBody>{`Couldn’t load ${what}. Reload the page to try again.`}</MessageBarBody>
    </MessageBar>
  );
}

/** Stands in for a console page while its data loads (`aria-busy`). */
export function ConsoleSkeleton() {
  const s = useStyles();
  return (
    <Skeleton className={s.skeleton} aria-busy aria-label="Loading">
      <SkeletonItem size={32} />
      <SkeletonItem size={96} />
      <SkeletonItem size={96} />
    </Skeleton>
  );
}

/** The badge colors: a super-admin in brand, a suspension in danger, an unconfirmed email in warning. */
const BADGE_COLORS = { superadmin: 'brand', suspended: 'danger', unconfirmed: 'warning' } as const;

/** An account's labels as Fluent badges, each with its words (never color alone). */
export function UserBadges({ badges }: { badges: readonly UserBadge[] }) {
  const s = useStyles();
  if (badges.length === 0) return null;
  return (
    <span className={s.badges}>
      {badges.map((badge) => (
        <Badge key={badge} appearance="tint" color={BADGE_COLORS[badge]} data-badge={badge}>
          {BADGE_LABELS[badge]}
        </Badge>
      ))}
    </span>
  );
}
