'use client';

import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { ColumnChart } from '@/modules/dashboard/ui/charts';
import { formatNumber } from '../domain/format';
import { signupSeries, tierLabel, type Overview } from '../domain/overview';
import { ConsolePage, LoadFailed } from './page-frame';

const useStyles = makeStyles({
  tiles: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: tokens.spacingHorizontalM,
    margin: 0,
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tileLabel: { ...typographyStyles.caption1Strong, color: tokens.colorNeutralForeground2 },
  tileValue: {
    ...typographyStyles.title2,
    margin: 0,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums',
  },
  tileNote: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
  },
  heading: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    ...typographyStyles.body1,
    '& th, & td': {
      textAlign: 'start',
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    '& td:last-child, & th:last-child': { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  },
  muted: { margin: 0, color: tokens.colorNeutralForeground3 },
});

/** One number with its label and, below, what it is out of. */
function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  const s = useStyles();
  return (
    <div className={s.tile} role="group" aria-label={label}>
      <span className={s.tileLabel}>{label}</span>
      <p className={s.tileValue}>{formatNumber(value)}</p>
      {note && <p className={s.tileNote}>{note}</p>}
    </div>
  );
}

/** A small two-column table: a name and a count, with a heading and an empty state. */
function CountTable({
  title,
  head,
  rows,
  empty,
}: {
  title: string;
  head: readonly [string, string];
  rows: readonly (readonly [string, number])[];
  empty: string;
}) {
  const s = useStyles();
  return (
    <section className={s.section} aria-label={title}>
      <h2 className={s.heading}>{title}</h2>
      {rows.length === 0 ? (
        <p className={s.muted}>{empty}</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">{head[0]}</th>
              <th scope="col">{head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, count]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{formatNumber(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * The console's overview (#516): accounts, browsers, jobs and emails as tiles, sign-ups per day for the last 30 days
 * as columns (the dashboard's chart, with its hover and table view), and the Xomoni versions and plans in use.
 * `overview` is null when the database couldn't give it.
 */
export function ConsoleOverview({ overview, today }: { overview: Overview | null; today: string }) {
  const s = useStyles();
  if (!overview) {
    return (
      <ConsolePage title="Overview">
        <LoadFailed what="the overview" />
      </ConsolePage>
    );
  }
  const { users, devices, jobs, emails } = overview;
  return (
    <ConsolePage title="Overview" description="Xomoni accounts, browsers and jobs, right now.">
      <div className={s.tiles}>
        <Tile label="Accounts" value={users.total} note={`${formatNumber(users.confirmed)} confirmed`} />
        <Tile label="New in 7 days" value={users.new7d} note={`${formatNumber(users.new30d)} in 30 days`} />
        <Tile label="Signed in, 30 days" value={users.signedIn30d} />
        <Tile label="With two-step verification" value={users.withMfa} />
        <Tile label="Suspended" value={users.banned} />
        <Tile
          label="Browsers connected"
          value={devices.total}
          note={`${formatNumber(devices.active7d)} active in 7 days`}
        />
        <Tile label="Jobs running" value={jobs.running} note={`${formatNumber(jobs.waiting)} waiting`} />
        <Tile label="Jobs finished, 7 days" value={jobs.finished7d} note={`${formatNumber(jobs.total)} in all`} />
        <Tile
          label="Weekly email"
          value={emails.weekly}
          note={`${formatNumber(emails.healthAlerts)} with X warnings`}
        />
      </div>
      <section className={s.section} aria-label="Sign-ups per day">
        <h2 className={s.heading}>Sign-ups per day, last 30 days</h2>
        <ColumnChart points={signupSeries(overview.signups, today)} label="Sign-ups" today={today} />
      </section>
      <div className={s.columns}>
        <CountTable
          title="Xomoni versions in use"
          head={['Version', 'Browsers']}
          rows={devices.versions.map((v) => [v.version, v.devices] as const)}
          empty="No browser connected yet."
        />
        <CountTable
          title="Plans"
          head={['Plan', 'Accounts']}
          rows={overview.plans.map((p) => [tierLabel(p.tier), p.accounts] as const)}
          empty="No plan yet."
        />
      </div>
    </ConsolePage>
  );
}
