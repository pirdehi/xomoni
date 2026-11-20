'use client';
// The Engagement place (#255): what the person's posts received each day (likes, replies, reposts, quotes and views),
// the engagement rate, and how many of the posts seen had a like, from the daily numbers they chose to show
// (ADR-0026). Received figures are estimates: Xomoni counts what it saw rise in the posts X showed, and says how many
// sightings that was. The most-liked replies need the replies themselves, which stay in Xomoni. On Fluent UI
// (ADR-0019).
import { makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { Info16Regular, Library16Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { TextLink } from '@/shared/ui/links';
import {
  RECEIVED_TYPES,
  daysBefore,
  daysInScope,
  engagementFigures,
  isoDay,
  rateSeries,
  receivedByType,
  viewsSeries,
} from '../domain/insights';
import type { DailyNumbers } from '../domain/model';
import { PERIODS, type Scope, scopeQuery } from '../domain/scope';
import { sectionHref } from '../domain/sections';
import { ColumnChart, LineChart, StackedColumnChart, formatCount } from './charts';
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
    '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
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
  note: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalS },
  icon: { flexShrink: 0, marginTop: '2px', color: tokens.colorBrandForeground1 },
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

/**
 * Engagement for the chosen account and period (#255). Without numbers in the period it says why and where to turn
 * them on. `inXomoni` opens Xomoni's Library, where the replies themselves are.
 */
export function Engagement({
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
  const f = engagementFigures(current, daysBefore(days, scope, now));
  const period =
    PERIODS.find((p) => p.id === scope.period)
      ?.label.replace(/^Last /, '')
      .toLowerCase() ?? '';
  const versus = scope.period === 'all' ? 'all' : period;
  const views = viewsSeries(current, scope, now);
  const rates = rateSeries(current, scope, now);

  const local = (
    <section className={mergeClasses(s.card, s.stack)} aria-labelledby="liked-replies-title">
      <div className={s.head}>
        <Library16Regular className={s.icon} aria-hidden />
        <h2 id="liked-replies-title" className={s.title}>
          Your most-liked replies
        </h2>
      </div>
      <p className={s.text}>They need your replies themselves, which never leave your computer: see them in Xomoni.</p>
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
              : 'What your posts receive shows here once you turn on Show my numbers on xomoni.com.'}
          </p>
          {!shown && <TextLink href={sectionHref('overview', scopeQuery(scope))}>Turn them on in Overview</TextLink>}
        </section>
        {local}
      </div>
    );
  }

  const count = (figure: { value: number | null }) => (figure.value === null ? '—' : formatCount(figure.value));
  return (
    <div className={s.root}>
      <p className={mergeClasses(s.meta, s.note)}>
        <Info16Regular className={s.icon} aria-hidden />
        <span>
          Estimates: Xomoni counts what it saw rise on your posts while X showed them, over{' '}
          {formatCount(f.observedPosts)} sightings in this period. X gives totals per post, not when each like came.
        </span>
      </p>
      <ul className={s.tiles} aria-label="What your posts received">
        <Tile
          label="Likes received"
          value={count(f.likes)}
          note={<Delta figure={f.likes} period={versus} upIsGood />}
        />
        <Tile
          label="Replies received"
          value={count(f.replies)}
          note={<Delta figure={f.replies} period={versus} upIsGood />}
        />
        <Tile
          label="Reposts and quotes"
          value={formatCount((f.reposts.value ?? 0) + (f.quotes.value ?? 0))}
          note={
            <Delta
              figure={{
                value: (f.reposts.value ?? 0) + (f.quotes.value ?? 0),
                previous: f.reposts.previous === null ? null : f.reposts.previous + (f.quotes.previous ?? 0),
              }}
              period={versus}
              upIsGood
            />
          }
        />
        <Tile label="Views" value={count(f.views)} note={<Delta figure={f.views} period={versus} upIsGood />} />
        <Tile
          label="Engagement rate"
          value={f.rate.value === null ? '—' : `${f.rate.value.toFixed(1)}%`}
          note={
            f.rate.value === null ? 'No views seen yet' : <Delta figure={f.rate} period={versus} unit="%" upIsGood />
          }
        />
        <Tile
          label="Seen with at least one like"
          value={f.postsLiked === null ? '—' : `${Math.round(f.postsLiked)}%`}
          note={`${formatCount(f.repliesLiked)} of them replies`}
        />
      </ul>

      <div className={s.charts}>
        <section className={mergeClasses(s.card, s.stack, s.wide)} aria-labelledby="received-title">
          <h2 id="received-title" className={s.title}>
            Received each day
          </h2>
          <StackedColumnChart
            points={receivedByType(current, scope, now)}
            series={RECEIVED_TYPES}
            label="Likes, replies, reposts and quotes received"
            today={today}
          />
        </section>
        <section className={mergeClasses(s.card, s.stack)} aria-labelledby="views-title">
          <h2 id="views-title" className={s.title}>
            Views
          </h2>
          <ColumnChart points={views} label="Views" today={today} />
        </section>
        <section className={mergeClasses(s.card, s.stack)} aria-labelledby="rate-title">
          <h2 id="rate-title" className={s.title}>
            Engagement rate
          </h2>
          {rates.some((p) => p.value !== null) ? (
            <LineChart points={rates} label="Engagement rate, per 100 views" today={today} />
          ) : (
            <p className={s.meta}>No views seen in this period yet.</p>
          )}
        </section>
      </div>

      {local}
    </div>
  );
}
