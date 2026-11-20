'use client';
// Reports on xomoni.com (#257): weekly, monthly, the year in review, what Xomoni removed, and the person's own, from the
// daily numbers and the jobs the cloud already has. Kept as CSV, made in the browser, or as PDF with the browser's
// own print (what is marked `data-print="hide"` stays off paper). On Fluent UI (ADR-0019).
import {
  Button,
  Checkbox,
  Radio,
  RadioGroup,
  Switch,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { ArrowDownload16Regular, Print16Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { TextLink } from '@/shared/ui/links';
import { change, daysInScope } from '../domain/insights';
import type { DailyNumbers, JobSummary } from '../domain/model';
import {
  type Cell,
  METRICS,
  type MetricId,
  REPORTS,
  type ReportId,
  cleanupJobs,
  jobsCsv,
  metricsOf,
  periodTable,
  removedByKind,
  reportFileName,
  reportFor,
  reportScope,
  summaryRows,
  tableCsv,
  toCsv,
} from '../domain/reports';
import { PERIODS, type Scope, scopeQuery } from '../domain/scope';
import { sectionHref } from '../domain/sections';
import { formatCount } from './charts';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    overflowX: 'auto',
  },
  title: { ...typographyStyles.subtitle1, margin: 0 },
  subtitle: { ...typographyStyles.subtitle2, margin: 0 },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  choices: { flexWrap: 'wrap', rowGap: tokens.spacingVerticalXS },
  metrics: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalL },
  table: { borderCollapse: 'collapse', width: '100%', ...typographyStyles.body1 },
  th: {
    textAlign: 'left',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
  },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
});

/** A number in a table: `—` when there is none. */
const shown = (value: number | null) => (value === null ? '—' : formatCount(value));

/** How a figure moved, as "+12 (+5%)", "−3" or "—". */
function moved(value: number | null, previous: number | null): string {
  const diff = change({ value, previous });
  if (!diff) return '—';
  const sign = diff.change > 0 ? '+' : diff.change < 0 ? '−' : '';
  const percent = diff.percent === null ? '' : ` (${sign}${Math.abs(Math.round(diff.percent))}%)`;
  return `${sign}${formatCount(Math.abs(diff.change))}${percent}`;
}

/** Hands the person a file made in the browser; nothing is sent anywhere. */
function download(name: string, text: string) {
  // A byte-order mark, so spreadsheets read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reports (#257): pick a ready-made report or build one, see it as tables, and keep it as CSV or PDF. Numbers come
 * from the daily numbers the person chose to show (ADR-0026); the cleanup report also lists the jobs.
 */
export function ReportsPlace({
  days,
  jobs,
  scope,
  now,
  shown: numbersShown,
  email,
}: {
  days: readonly DailyNumbers[];
  jobs: readonly JobSummary[];
  scope: Scope;
  now: number;
  /** Whether the person shows their numbers on xomoni.com; null while that isn't known. */
  shown: boolean | null;
  /** The weekly email (ADR-0031): whether it is on (null while read), and how to change it. */
  email: { on: boolean | null; set: (enabled: boolean) => Promise<string | null> };
}) {
  const s = useStyles();
  const [reportId, setReportId] = useState<ReportId>('week');
  const [chosen, setChosen] = useState<readonly MetricId[]>(REPORTS[0]?.metrics ?? []);
  const report = reportFor(reportId);
  const covered = reportScope(report, scope);
  const metrics = metricsOf(report.id === 'custom' ? chosen : report.metrics);
  const period = PERIODS.find((p) => p.id === covered.period)?.label ?? '';
  const account = covered.account ? `@${covered.account}` : 'All accounts';
  const inPeriod = daysInScope(days, covered, now);
  const made = new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const toggle = (id: MetricId, on: boolean) =>
    setChosen(on ? [...chosen, id] : chosen.filter((other) => other !== id));

  let body;
  let csv: Cell[][] | null = null;
  if (report.id === 'cleanup') {
    const done = cleanupJobs(jobs, covered, now);
    const kinds = removedByKind(inPeriod);
    csv = jobsCsv(done);
    body = (
      <>
        {kinds && (
          <p className={s.text}>
            Removed in this period: {formatCount(kinds.posts)} posts, {formatCount(kinds.replies)} replies,{' '}
            {formatCount(kinds.reposts)} reposts and {formatCount(kinds.likes)} likes.
          </p>
        )}
        {done.length === 0 ? (
          <p className={s.text}>No cleanup ran in this period.</p>
        ) : (
          <table className={s.table}>
            <caption className={s.meta}>Cleanup jobs, newest first</caption>
            <thead>
              <tr>
                <th className={s.th} scope="col">
                  Job
                </th>
                <th className={s.th} scope="col">
                  Account
                </th>
                <th className={mergeClasses(s.th, s.num)} scope="col">
                  Removed
                </th>
                <th className={mergeClasses(s.th, s.num)} scope="col">
                  Skipped
                </th>
                <th className={mergeClasses(s.th, s.num)} scope="col">
                  Failed
                </th>
                <th className={s.th} scope="col">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {done.map((job) => (
                <tr key={job.id}>
                  <th className={s.td} scope="row">
                    {job.title}
                  </th>
                  <td className={s.td}>@{job.xHandle}</td>
                  <td className={mergeClasses(s.td, s.num)}>{formatCount(job.done)}</td>
                  <td className={mergeClasses(s.td, s.num)}>{formatCount(job.skipped)}</td>
                  <td className={mergeClasses(s.td, s.num)}>{formatCount(job.failed)}</td>
                  <td className={s.td}>
                    {new Date(job.updatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  } else if (inPeriod.length === 0) {
    body = (
      <section aria-label="No numbers yet">
        <p className={s.text}>
          {numbersShown
            ? 'No numbers in this period yet. They come with Xomoni’s next report from your computer.'
            : 'Reports are made from your daily numbers, once you turn on Show my numbers on xomoni.com.'}
        </p>
        {!numbersShown && (
          <TextLink href={sectionHref('overview', scopeQuery(scope))}>Turn them on in Overview</TextLink>
        )}
      </section>
    );
  } else if (metrics.length === 0) {
    body = <p className={s.text}>Pick at least one number to report.</p>;
  } else {
    const summary = summaryRows(days, covered, metrics, now);
    const table = periodTable(days, covered, metrics, now);
    const observed = inPeriod.reduce((sum, d) => sum + d.observedPosts, 0);
    csv = tableCsv(table, metrics);
    body = (
      <>
        <table className={s.table}>
          <caption className={s.meta}>
            {covered.period === 'all' ? 'All time' : 'This period and the one before'}
          </caption>
          <thead>
            <tr>
              <th className={s.th} scope="col">
                Number
              </th>
              <th className={mergeClasses(s.th, s.num)} scope="col">
                {period}
              </th>
              {covered.period !== 'all' && (
                <>
                  <th className={mergeClasses(s.th, s.num)} scope="col">
                    Before
                  </th>
                  <th className={mergeClasses(s.th, s.num)} scope="col">
                    Change
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.metric.id}>
                <th className={s.td} scope="row">
                  {row.metric.label}
                  {row.metric.estimate && ' *'}
                </th>
                <td className={mergeClasses(s.td, s.num)}>{shown(row.value)}</td>
                {covered.period !== 'all' && (
                  <>
                    <td className={mergeClasses(s.td, s.num)}>{shown(row.previous)}</td>
                    <td className={mergeClasses(s.td, s.num)}>{moved(row.value, row.previous)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {metrics.some((m) => m.estimate) && (
          <p className={s.meta}>
            * Estimates, from the {formatCount(observed)} sightings of your posts Xomoni had in this period.
          </p>
        )}
        <h3 className={s.subtitle}>{table.grain === 'day' ? 'Each day' : 'Each month'}</h3>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th} scope="col">
                {table.grain === 'day' ? 'Day' : 'Month'}
              </th>
              {metrics.map((m) => (
                <th key={m.id} className={mergeClasses(s.th, s.num)} scope="col">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.when}>
                <th className={s.td} scope="row">
                  {row.when}
                </th>
                {row.values.map((value, i) => (
                  <td key={metrics[i]?.id} className={mergeClasses(s.td, s.num)}>
                    {shown(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <div className={s.root}>
      <section className={s.card} aria-labelledby="pick-title" data-print="hide">
        <h2 id="pick-title" className={s.subtitle}>
          Report
        </h2>
        <RadioGroup
          className={s.choices}
          layout="horizontal"
          aria-labelledby="pick-title"
          value={reportId}
          onChange={(_, data) => setReportId(reportFor(data.value).id)}
        >
          {REPORTS.map((r) => (
            <Radio key={r.id} value={r.id} label={r.label} />
          ))}
        </RadioGroup>
        <p className={s.meta}>{report.summary}</p>
        {report.id === 'custom' && (
          <fieldset className={s.metrics}>
            <legend className={s.meta}>Numbers to report</legend>
            {METRICS.map((m) => (
              <Checkbox
                key={m.id}
                label={m.label}
                checked={chosen.includes(m.id)}
                onChange={(_, data) => toggle(m.id, data.checked === true)}
              />
            ))}
          </fieldset>
        )}
      </section>
      <WeeklyEmail email={email} numbersShown={numbersShown} />
      <section className={s.card} aria-labelledby="report-title">
        <div>
          <h2 id="report-title" className={s.title}>
            {report.label} report · {account} · {period}
          </h2>
          <p className={s.meta}>Made on xomoni.com on {made}, from what Xomoni counted on your computer.</p>
        </div>
        {body}
        <div className={s.row} data-print="hide">
          <Button
            appearance="primary"
            icon={<ArrowDownload16Regular />}
            disabled={!csv}
            onClick={() => csv && download(reportFileName(report, covered, now, 'csv'), toCsv(csv))}
          >
            Download CSV
          </Button>
          <Button icon={<Print16Regular />} onClick={() => window.print()}>
            Save as PDF
          </Button>
          <span className={s.meta}>Save as PDF opens your browser’s print window: choose Save as PDF there.</span>
        </div>
      </section>
    </div>
  );
}

/**
 * The weekly email (#257, ADR-0031): last week's numbers every Monday, only for those who turn it on, and only while
 * their daily numbers are on. Each email carries its own way to stop it.
 */
function WeeklyEmail({
  email,
  numbersShown,
}: {
  email: { on: boolean | null; set: (enabled: boolean) => Promise<string | null> };
  numbersShown: boolean | null;
}) {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Off can always be chosen; on needs the daily numbers.
  const canTurnOn = numbersShown === true;
  return (
    <section className={s.card} aria-labelledby="email-title" data-print="hide">
      <h2 id="email-title" className={s.subtitle}>
        Weekly email
      </h2>
      <Switch
        label="Email me my week every Monday"
        checked={email.on === true}
        disabled={email.on === null || busy || (!email.on && !canTurnOn)}
        onChange={(_, data) => {
          setBusy(true);
          setError(null);
          void email.set(data.checked).then((message) => {
            setError(message);
            setBusy(false);
          });
        }}
      />
      <p className={s.meta}>
        {canTurnOn
          ? 'Last week’s numbers, against the week before, on Monday morning, to the address you sign in with. Counts only, and every email has a link to stop it.'
          : 'Turn on your daily numbers first: the email is made of them.'}
      </p>
      {error && (
        <p className={s.text} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
