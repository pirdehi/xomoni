'use client';
// The Content place (#254): what the person published, by type, against the period before; each day (or week) by type;
// and which weekday they publish most, from the daily numbers they chose to show (ADR-0026). What needs the posts
// themselves (the best hour, top posts, posts no one engaged with, how old what is still online is) stays in Xomoni on
// the person's computer. On Fluent UI (ADR-0019).
import { makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { Library16Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { TextLink } from '@/shared/ui/links';
import {
  CONTENT_TYPES,
  WEEKDAYS,
  contentFigures,
  daysBefore,
  daysInScope,
  isoDay,
  publishedByType,
  weekdayAverages,
} from '../domain/insights';
import type { DailyNumbers } from '../domain/model';
import { PERIODS, type Scope, scopeQuery } from '../domain/scope';
import { sectionHref } from '../domain/sections';
import { StackedColumnChart, formatCount } from './charts';
import { Delta } from './delta';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXL },
  card: {
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  tiles: {
    display: 'grid',
    gap: tokens.spacingHorizontalM,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
  },
  label: { ...typographyStyles.caption1Strong, margin: 0, color: tokens.colorNeutralForeground3 },
  value: { ...typographyStyles.title2, margin: 0, color: tokens.colorNeutralForeground1 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  title: { ...typographyStyles.subtitle2, margin: 0 },
  meters: { display: 'grid', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0, listStyleType: 'none' },
  meter: {
    display: 'grid',
    gridTemplateColumns: '3em minmax(0, 1fr) 5em',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    ...typographyStyles.body1,
  },
  track: { height: '8px', borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorBrandBackground2 },
  fill: { height: '100%', borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorBrandStroke1 },
  figure: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: tokens.colorNeutralForeground2 },
  best: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  points: {
    display: 'grid',
    rowGap: tokens.spacingVerticalXXS,
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    listStyleType: 'disc',
    ...typographyStyles.body1,
  },
  head: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  icon: { flexShrink: 0, color: tokens.colorBrandForeground1 },
  action: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
});

/**
 * Content for the chosen account and period (#254). Without numbers in the period it says why and where to turn them
 * on. `inXomoni` opens Xomoni's Library and Cleanup, where the posts themselves are.
 */
export function Content({
  days,
  scope,
  now,
  shown,
  inXomoni,
}: {
  days: readonly DailyNumbers[];
  scope: Scope;
  now: number;
  /** Whether the account shows its daily numbers; null while it is read. */
  shown: boolean | null;
  inXomoni: ReactNode;
}) {
  const s = useStyles();
  const today = isoDay(now);
  const current = daysInScope(days, scope, now);
  const figures = contentFigures(current, daysBefore(days, scope, now));
  const byType = publishedByType(current, scope, now);
  const { averages, best } = weekdayAverages(current);
  const top = Math.max(...averages.map((a) => a ?? 0), 0);
  const period =
    PERIODS.find((p) => p.id === scope.period)
      ?.label.replace(/^Last /, '')
      .toLowerCase() ?? '';
  const versus = scope.period === 'all' ? 'all' : period;

  const local = (
    <section className={mergeClasses(s.card, s.stack)} aria-labelledby="local-title">
      <div className={s.head}>
        <Library16Regular className={s.icon} aria-hidden />
        <h2 id="local-title" className={s.title}>
          From your posts, in Xomoni
        </h2>
      </div>
      <p className={s.text}>These need your posts themselves, which never leave your computer:</p>
      <ul className={s.points}>
        <li>your best hour to post</li>
        <li>your top posts</li>
        <li>posts no one engaged with, ready to clean up</li>
        <li>how old the posts still online are</li>
      </ul>
      <div className={s.action}>{inXomoni}</div>
    </section>
  );

  if (current.length === 0) {
    return (
      <div className={s.root}>
        <section className={mergeClasses(s.card, s.stack)} aria-label="No numbers yet">
          <p className={s.text}>
            {shown
              ? 'No numbers in this period yet. They come with Xomoni’s next report from your computer.'
              : 'What you publish shows here once you turn on Show my numbers on xomoni.com.'}
          </p>
          {!shown && <TextLink href={sectionHref('overview', scopeQuery(scope))}>Turn them on in Overview</TextLink>}
        </section>
        {local}
      </div>
    );
  }

  return (
    <div className={s.root}>
      <ul className={s.tiles} aria-label="What you published">
        {CONTENT_TYPES.map((t) => (
          <li key={t.id} className={mergeClasses(s.card, s.stack)}>
            <p className={s.label}>{t.label}</p>
            <p className={s.value}>{formatCount(figures[t.id].value ?? 0)}</p>
            <p className={s.meta}>
              <Delta figure={figures[t.id]} period={versus} />
            </p>
          </li>
        ))}
      </ul>

      <section className={mergeClasses(s.card, s.stack)} aria-labelledby="by-type-title">
        <h2 id="by-type-title" className={s.title}>
          Published by type
        </h2>
        <StackedColumnChart
          points={byType}
          series={CONTENT_TYPES}
          label="Posts, replies, reposts and quotes"
          today={today}
        />
      </section>

      <section className={mergeClasses(s.card, s.stack)} aria-labelledby="weekday-title">
        <h2 id="weekday-title" className={s.title}>
          When you publish
        </h2>
        <p className={s.meta}>
          {best === null
            ? 'Nothing published on the days with numbers yet.'
            : `You publish most on ${['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][best]}.`}{' '}
          Items a day, on average over the days with numbers.
        </p>
        <ul className={s.meters} aria-label="Items published a day, by weekday">
          {WEEKDAYS.map((name, i) => {
            const a = averages[i] ?? null;
            return (
              <li key={name} className={s.meter}>
                <span className={i === best ? s.best : undefined}>{name}</span>
                <span className={s.track} aria-hidden>
                  <span className={s.fill} style={{ width: `${a && top ? (a / top) * 100 : 0}%`, display: 'block' }} />
                </span>
                <span className={s.figure}>{a === null ? '—' : a.toFixed(1)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {local}
    </div>
  );
}
