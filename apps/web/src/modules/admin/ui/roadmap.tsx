'use client';

import { Badge, ProgressBar, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { formatNumber, formatWhen, plural } from '../domain/format';
import { phasePercent, type KeyResult, type PlanItem, type PublishedPlan } from '../domain/plan';
import { ConsolePage, LoadFailed } from './page-frame';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, minWidth: 0 },
  heading: { ...typographyStyles.subtitle1, margin: 0, color: tokens.colorNeutralForeground1 },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: tokens.spacingHorizontalM,
    alignItems: 'start',
  },
  column: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, minWidth: 0 },
  columnTitle: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground2 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  itemTitle: { ...typographyStyles.body1Strong, margin: 0, color: tokens.colorNeutralForeground1 },
  text: { margin: 0, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase300 },
  muted: { margin: 0, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  issues: { margin: 0, paddingInlineStart: tokens.spacingHorizontalL, listStyleType: 'disc' },
  issue: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  link: { color: tokens.colorBrandForegroundLink, ':hover': { textDecorationLine: 'underline' } },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: tokens.spacingHorizontalM,
    margin: 0,
  },
  fact: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    '& dt': { ...typographyStyles.caption1Strong, color: tokens.colorNeutralForeground2 },
    '& dd': { ...typographyStyles.subtitle1, margin: 0, fontVariantNumeric: 'tabular-nums' },
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    ...typographyStyles.body1,
    '& th, & td': {
      textAlign: 'start',
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
      verticalAlign: 'top',
    },
  },
  scroller: { overflowX: 'auto' },
  phase: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  list: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, margin: 0, padding: 0 },
});

/** A plan item's progress bar, named for screen readers. */
function Progress({ label, percent }: { label: string; percent: number }) {
  return <ProgressBar value={percent / 100} thickness="large" aria-label={label} aria-valuetext={`${percent}%`} />;
}

function Item({ item }: { item: PlanItem }) {
  const s = useStyles();
  const done = `${formatNumber(item.counts.done)} of ${formatNumber(item.total)} done`;
  return (
    <article className={s.card}>
      <p className={s.itemTitle} dir="auto">
        {item.titleFa || item.id}
      </p>
      {item.whyFa && (
        <p className={s.text} dir="auto">
          {item.whyFa}
        </p>
      )}
      <Progress label={`${item.titleFa || item.id}: ${item.percent}%`} percent={item.percent} />
      <p
        className={s.muted}
      >{`${item.percent}% · ${done}${item.counts.founder ? ` · ${formatNumber(item.counts.founder)} waiting on you` : ''}`}</p>
      {item.issues.length > 0 && (
        <ul className={s.issues}>
          {item.issues.map((issue, index) => (
            <li key={issue.number ?? `${issue.title}-${index}`} className={s.issue}>
              {issue.url ? (
                <a href={issue.url} target="_blank" rel="noopener noreferrer" className={s.link} dir="auto">
                  {issue.number !== null ? `#${issue.number} ` : ''}
                  {issue.title}
                </a>
              ) : (
                <span dir="auto">
                  {issue.number !== null ? `#${issue.number} ` : ''}
                  {issue.title}
                </span>
              )}
              {issue.status && ` · ${issue.status}`}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

const HORIZONS = [
  ['now', 'Now'],
  ['next', 'Next'],
  ['later', 'Later'],
] as const;

/** A key result as "value / target unit", or what is missing. */
function keyResultValue(kr: KeyResult): string {
  const unit = kr.unit ? ` ${kr.unit}` : '';
  if (kr.value === null) return kr.target === null ? 'Not measured yet' : `Target ${formatNumber(kr.target)}${unit}`;
  return kr.target === null
    ? `${formatNumber(kr.value)}${unit}`
    : `${formatNumber(kr.value)} of ${formatNumber(kr.target)}${unit}`;
}

/**
 * The console's roadmap (#516): the maintainer's private plan as their own tool last published it (Now, Next and Later
 * with progress and issues; objectives and key results; what waits on the founder; the public roadmap's phases; a few
 * numbers on how work flows). Its Persian words are shown as they come, each in its own direction. `published` is null
 * before the first publication; `failed` when the database couldn't give it.
 */
export function Roadmap({ published, failed = false }: { published: PublishedPlan | null; failed?: boolean }) {
  const s = useStyles();
  if (failed) {
    return (
      <ConsolePage title="Roadmap">
        <LoadFailed what="the plan" />
      </ConsolePage>
    );
  }
  if (!published) {
    return (
      <ConsolePage title="Roadmap">
        <p className={s.text} role="status">
          The plan hasn’t been published yet. The maintainer’s tool publishes it to the database; it shows here once it
          has.
        </p>
      </ConsolePage>
    );
  }
  const { plan } = published;
  const flow = [
    ['Latest release', plan.release.latest],
    ['Open pull requests', plan.flow.openPRs],
    ['Merged in 7 days', plan.flow.mergedLast7],
    ['Lead time, hours', plan.flow.leadTimeHours],
    ['Failing checks', plan.flow.failing],
    ['With conflicts', plan.flow.conflicts],
  ] as const;

  return (
    <ConsolePage title="Roadmap" description={`Published ${formatWhen(published.updatedAt)}`}>
      <section aria-label="How work flows">
        <dl className={s.facts}>
          {flow.map(([label, value]) =>
            value === null ? null : (
              <div key={label} className={s.fact}>
                <dt>{label}</dt>
                <dd>{typeof value === 'number' ? formatNumber(value) : value}</dd>
              </div>
            ),
          )}
        </dl>
      </section>

      {plan.northStar && (
        <section className={s.section} aria-label="North star">
          <h2 className={s.heading}>North star</h2>
          <div className={s.card}>
            <p className={s.itemTitle} dir="auto">
              {plan.northStar.titleFa || plan.northStar.title}
            </p>
            {plan.northStar.definitionFa && (
              <p className={s.text} dir="auto">
                {plan.northStar.definitionFa}
              </p>
            )}
            <p className={s.muted}>
              {plan.northStar.value === null ? 'Not measured yet' : formatNumber(plan.northStar.value)}
              {plan.northStar.measured && ` · measured ${formatWhen(plan.northStar.measured)}`}
            </p>
          </div>
        </section>
      )}

      <section className={s.section} aria-label="Now, next and later">
        <h2 className={s.heading}>Now, next and later</h2>
        <div className={s.columns}>
          {HORIZONS.map(([key, title]) => (
            <div key={key} className={s.column} role="group" aria-label={title}>
              <h3 className={s.columnTitle}>{`${title} (${plan.horizons[key].length})`}</h3>
              {plan.horizons[key].length === 0 ? (
                <p className={s.muted}>Nothing here.</p>
              ) : (
                plan.horizons[key].map((item) => <Item key={item.id} item={item} />)
              )}
            </div>
          ))}
        </div>
      </section>

      {plan.objectives.length > 0 && (
        <section className={s.section} aria-label="Objectives">
          <h2 className={s.heading}>Objectives</h2>
          <div className={s.columns}>
            {plan.objectives.map((objective) => (
              <article key={objective.id} className={s.card}>
                <p className={s.itemTitle} dir="auto">
                  {objective.titleFa || objective.title}
                </p>
                <ul className={s.issues}>
                  {objective.keyResults.map((kr) => (
                    <li key={kr.id} className={s.issue}>
                      <span dir="auto">{kr.titleFa}</span>
                      {` · ${keyResultValue(kr)}`}
                      {kr.auto && ' · measured by the tool'}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className={s.section} aria-label="Waiting on the founder">
        <h2 className={s.heading}>Waiting on the founder</h2>
        {plan.founder.length === 0 ? (
          <p className={s.muted}>Nothing is waiting on you.</p>
        ) : (
          <div className={s.scroller}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Holds up</th>
                </tr>
              </thead>
              <tbody>
                {plan.founder.map((f, index) => (
                  <tr key={`${f.title}-${index}`}>
                    <td dir="auto">
                      {f.link ? (
                        <a href={f.link} target="_blank" rel="noopener noreferrer" className={s.link}>
                          {f.titleFa || f.title}
                        </a>
                      ) : (
                        f.titleFa || f.title
                      )}
                    </td>
                    <td>{f.ageDays === null ? '—' : plural(f.ageDays, 'day')}</td>
                    <td dir="auto">{f.impact || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {plan.phases.length > 0 && (
        <section className={s.section} aria-label="Phases">
          <h2 className={s.heading}>Phases</h2>
          <ul className={s.list}>
            {plan.phases.map((phase, index) => {
              const percent = phasePercent(phase);
              const name = `${phase.number !== null ? `Phase ${phase.number}: ` : ''}${phase.title}`;
              return (
                <li key={`${phase.number ?? index}`} className={s.phase}>
                  <span className={s.text} dir="auto">
                    {name}
                  </span>
                  <Progress label={`${name}: ${percent}%`} percent={percent} />
                  <span className={s.muted}>
                    {`${percent}% · ${formatNumber(phase.counts.done)} of ${formatNumber(phase.total)} done`}
                    {phase.counts.waiting > 0 && ` · ${formatNumber(phase.counts.waiting)} waiting`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {plan.lanes.length > 0 && (
        <section className={s.section} aria-label="Lanes">
          <h2 className={s.heading}>Lanes</h2>
          <div className={s.facts}>
            {plan.lanes.map((lane) => (
              <div key={lane.id} className={s.card}>
                <span className={s.itemTitle} dir="auto">
                  {lane.nameFa || lane.id}
                </span>
                <span className={s.muted}>
                  {`${formatNumber(lane.openPrs)} open${lane.limit === null ? '' : ` of ${formatNumber(lane.limit)}`}`}
                </span>
                {lane.overLimit && (
                  <Badge appearance="tint" color="warning">
                    Over its limit
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </ConsolePage>
  );
}
