'use client';
// The Audience place (#253): followers and following over time, gained and lost each day, milestones and the ratio,
// from the daily numbers the person chose to show (ADR-0026). Who followed or unfollowed comes only from comparing two
// X archives, which stay in Xomoni on the person's computer. On Fluent UI (ADR-0019).
import { makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { Flag16Regular, People16Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { TextLink } from '@/shared/ui/links';
import {
  audienceFigures,
  daysInScope,
  followersSeries,
  followingSeries,
  isoDay,
  milestones,
  netChanges,
  nextMilestone,
} from '../domain/insights';
import type { DailyNumbers } from '../domain/model';
import { PERIODS, type Scope, scopeQuery } from '../domain/scope';
import { sectionHref } from '../domain/sections';
import { ColumnChart, LineChart, formatCount, formatDay } from './charts';

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
  charts: {
    display: 'grid',
    gap: tokens.spacingHorizontalM,
    gridTemplateColumns: 'minmax(0, 1fr)',
    '@media (min-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' },
  },
  wide: { '@media (min-width: 900px)': { gridColumn: '1 / -1' } },
  list: { display: 'grid', rowGap: tokens.spacingVerticalXS, margin: 0, padding: 0, listStyleType: 'none' },
  item: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, ...typographyStyles.body1 },
  icon: { flexShrink: 0, color: tokens.colorBrandForeground1 },
  head: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  action: { display: 'flex' },
});

function Tile({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  const s = useStyles();
  return (
    <li className={mergeClasses(s.card, s.stack)}>
      <p className={s.label}>{label}</p>
      <p className={s.value}>{value}</p>
      <p className={s.meta}>{note}</p>
    </li>
  );
}

const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : n < 0 ? `−${formatCount(-n)}` : '0');

/**
 * Audience for the chosen account and period (#253). Without numbers in the period it says why and where to turn them
 * on. `archives` is what lets the person compare two X archives, in Xomoni.
 */
export function Audience({
  days,
  scope,
  now,
  shown,
  archives,
}: {
  days: readonly DailyNumbers[];
  scope: Scope;
  now: number;
  /** Whether the account shows its daily numbers; null while it is read. */
  shown: boolean | null;
  archives: ReactNode;
}) {
  const s = useStyles();
  const today = isoDay(now);
  const current = daysInScope(days, scope, now);
  const followers = followersSeries(current, scope, now);
  const following = followingSeries(current, scope, now);
  const changes = netChanges(followers);
  const figures = audienceFigures(current, followers);
  const reached = milestones(followers);
  const next = figures.followers === null ? null : nextMilestone(figures.followers);
  const period = PERIODS.find((p) => p.id === scope.period)?.label.toLowerCase() ?? '';
  const overview = sectionHref('overview', scopeQuery(scope));

  const whoFollowed = (
    <section className={mergeClasses(s.card, s.stack)} aria-labelledby="who-title">
      <div className={s.head}>
        <People16Regular className={s.icon} aria-hidden />
        <h2 id="who-title" className={s.title}>
          Who followed or unfollowed you
        </h2>
      </div>
      <p className={s.text}>
        X shows no one’s name in the numbers. Xomoni can compare two of your X archives on your computer, and the names
        stay there.
      </p>
      <div className={s.action}>{archives}</div>
    </section>
  );

  if (current.length === 0) {
    return (
      <div className={s.root}>
        <section className={mergeClasses(s.card, s.stack)} aria-label="No numbers yet">
          <p className={s.text}>
            {shown
              ? `No numbers in this period yet. They come with Xomoni’s next report from your computer.`
              : 'Your audience shows here once you turn on Show my numbers on xomoni.com.'}
          </p>
          {!shown && <TextLink href={overview}>Turn them on in Overview</TextLink>}
        </section>
        {whoFollowed}
      </div>
    );
  }

  return (
    <div className={s.root}>
      <ul className={s.tiles} aria-label="Your audience in numbers">
        <Tile
          label="Followers"
          value={figures.followers === null ? '—' : formatCount(figures.followers)}
          note={
            figures.net === null
              ? 'No change to show yet'
              : `${signed(figures.net)} in the ${period.replace(/^last /, 'last ')}`
          }
        />
        <Tile
          label="Gained"
          value={formatCount(figures.gained)}
          note={
            figures.bestDay
              ? `Most on ${formatDay(figures.bestDay.day, today)}: ${signed(figures.bestDay.value ?? 0)}`
              : 'No gains in this period'
          }
        />
        <Tile
          label="Lost"
          value={formatCount(figures.lost)}
          note={
            figures.worstDay
              ? `Most on ${formatDay(figures.worstDay.day, today)}: ${signed(figures.worstDay.value ?? 0)}`
              : 'No losses in this period'
          }
        />
        <Tile
          label="Followers per account you follow"
          value={figures.ratio === null ? '—' : figures.ratio.toFixed(1)}
          note={figures.following === null ? 'Following not seen yet' : `You follow ${formatCount(figures.following)}`}
        />
      </ul>

      <div className={s.charts}>
        <section className={mergeClasses(s.card, s.stack, s.wide)} aria-labelledby="audience-followers">
          <h2 id="audience-followers" className={s.title}>
            Followers
          </h2>
          {followers.some((p) => p.value !== null) ? (
            <LineChart points={followers} label="Followers" today={today} />
          ) : (
            <p className={s.meta}>No follower count in this period yet: it comes when you open your X profile.</p>
          )}
        </section>
        <section className={mergeClasses(s.card, s.stack)} aria-labelledby="audience-net">
          <h2 id="audience-net" className={s.title}>
            Gained and lost each day
          </h2>
          {changes.some((p) => p.value !== null) ? (
            <ColumnChart points={changes} label="Followers gained or lost" today={today} signed />
          ) : (
            <p className={s.meta}>It takes two days with a follower count to show a change.</p>
          )}
          <p className={s.meta}>A day after a gap carries the whole change since the last count.</p>
        </section>
        <section className={mergeClasses(s.card, s.stack)} aria-labelledby="audience-following">
          <h2 id="audience-following" className={s.title}>
            Following
          </h2>
          {following.some((p) => p.value !== null) ? (
            <LineChart points={following} label="Following" today={today} />
          ) : (
            <p className={s.meta}>No following count in this period yet.</p>
          )}
        </section>
      </div>

      <section className={mergeClasses(s.card, s.stack)} aria-labelledby="milestones-title">
        <h2 id="milestones-title" className={s.title}>
          Milestones
        </h2>
        {reached.length > 0 ? (
          <ul className={s.list}>
            {reached.map((m) => (
              <li key={m.count} className={s.item}>
                <Flag16Regular className={s.icon} aria-hidden />
                {formatCount(m.count)} followers on {formatDay(m.day, today)}
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.text}>No milestone in this period.</p>
        )}
        {next && (
          <p className={s.meta}>
            Next: {formatCount(next.count)}, {formatCount(next.toGo)} to go.
          </p>
        )}
      </section>

      {whoFollowed}
    </div>
  );
}
