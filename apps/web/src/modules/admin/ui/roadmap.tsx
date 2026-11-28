'use client';

import { Badge, ProgressBar, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { formatNumber, formatWhen, plural } from '../domain/format';
import {
  TASK_STATES,
  phasePercent,
  type Direction,
  type DirectionNote,
  type DirectionStage,
  type KeyResult,
  type PlanItem,
  type PlanSource,
  type Program,
  type PublishedPlan,
  type TaskCounts,
} from '../domain/plan';
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
  sources: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  source: {
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusCircular,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    fontSize: tokens.fontSizeBase200,
  },
  stages: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  stage: {
    display: 'grid',
    gridTemplateColumns: '2.25rem minmax(0, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  stageNumber: {
    ...typographyStyles.subtitle2,
    width: '2.25rem',
    height: '2.25rem',
    display: 'grid',
    placeItems: 'center',
    borderRadius: tokens.borderRadiusCircular,
    border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  stageActive: { outline: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`, outlineOffset: '-1px' },
  badges: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXS, alignItems: 'center' },
  gate: {
    margin: 0,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  bar: {
    display: 'flex',
    gap: '2px',
    height: '0.75rem',
    borderRadius: tokens.borderRadiusCircular,
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalM}`,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  swatch: {
    display: 'inline-block',
    width: '0.75rem',
    height: '0.75rem',
    borderRadius: tokens.borderRadiusSmall,
    marginInlineEnd: tokens.spacingHorizontalXS,
    verticalAlign: 'middle',
  },
  done: { backgroundColor: tokens.colorStatusSuccessBackground3 },
  ci: { backgroundColor: tokens.colorBrandBackground },
  now: { backgroundColor: tokens.colorPaletteBerryBackground3 },
  ready: { backgroundColor: tokens.colorBrandBackground2, boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke1}` },
  todo: { backgroundColor: tokens.colorNeutralStroke1 },
  you: { backgroundColor: tokens.colorStatusWarningBackground3 },
});

const STAGE_STATE: Record<string, { label: string; color: 'brand' | 'informative' | 'warning' | 'subtle' }> = {
  active: { label: 'In progress', color: 'brand' },
  next: { label: 'Next', color: 'informative' },
  planned: { label: 'Planned', color: 'subtle' },
  'waiting-decision': { label: 'Waits on your decision', color: 'warning' },
};

const TASK_STATE_EN: Record<string, string> = {
  done: 'Merged',
  ci: 'In CI',
  now: 'Being worked on',
  ready: 'Code ready',
  todo: 'Not started',
  you: 'Waiting on you',
};

/** Tasks by state as one bar, with a legend that names every state and count, so color is never the only cue. */
function TaskBar({ counts, total, label }: { counts: TaskCounts; total: number; label: string }) {
  const s = useStyles();
  const sum = TASK_STATES.reduce((n, state) => n + (counts[state] ?? 0), 0);
  const all = Math.max(total, sum);
  const summary = TASK_STATES.filter((state) => (counts[state] ?? 0) > 0)
    .map((state) => `${formatNumber(counts[state] ?? 0)} ${TASK_STATE_EN[state]?.toLowerCase() ?? state}`)
    .join(', ');
  return (
    <div className={s.phase}>
      <div className={s.bar} role="img" aria-label={`${label}: ${summary || 'no tasks'}, of ${formatNumber(all)}`}>
        {all > 0 &&
          TASK_STATES.map((state) =>
            (counts[state] ?? 0) > 0 ? (
              <span key={state} className={s[state]} style={{ width: `${((counts[state] ?? 0) / all) * 100}%` }} />
            ) : null,
          )}
      </div>
      <ul className={s.legend} aria-hidden="true">
        {TASK_STATES.map((state) => (
          <li key={state}>
            <span className={`${s.swatch} ${s[state]}`} />
            {`${TASK_STATE_EN[state] ?? state} ${formatNumber(counts[state] ?? 0)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Links to the documents the plan is built from. */
function Sources({ sources }: { sources: readonly PlanSource[] }) {
  const s = useStyles();
  return (
    <section className={s.section} aria-label="Sources">
      <h2 className={s.heading}>Sources</h2>
      <ul className={s.sources}>
        {sources.map((source) => (
          <li key={source.id} className={s.source} dir="auto">
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className={s.link}>
                {source.titleFa || source.id}
              </a>
            ) : (
              source.titleFa || source.id
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourceBadges({ ids, sources }: { ids: readonly string[]; sources: readonly PlanSource[] }) {
  const s = useStyles();
  return ids.map((id) => {
    const source = sources.find((x) => x.id === id);
    if (!source) return null;
    return source.url ? (
      <a
        key={id}
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${s.link} ${s.muted}`}
        dir="auto"
      >
        {source.titleFa || id}
      </a>
    ) : (
      <span key={id} className={s.muted} dir="auto">
        {source.titleFa || id}
      </span>
    );
  });
}

function Decisions({ decisions }: { decisions: DirectionStage['decisions'] }) {
  const s = useStyles();
  if (decisions.length === 0) return null;
  return (
    <ul className={s.issues} aria-label="Decisions">
      {decisions.map((d) => (
        <li key={d.id} className={s.issue}>
          <Badge appearance="tint" color={d.done ? 'success' : 'warning'} size="small">
            {d.done ? 'Decided' : 'Open'}
          </Badge>{' '}
          <span dir="auto">{d.titleFa || d.id}</span>
        </li>
      ))}
    </ul>
  );
}

function Stage({
  stage,
  number,
  program,
  sources,
}: {
  stage: DirectionStage;
  number: number;
  program: Program | null;
  sources: readonly PlanSource[];
}) {
  const s = useStyles();
  const state = STAGE_STATE[stage.state] ?? { label: stage.state || 'Planned', color: 'subtle' as const };
  const live = stage.programWave === 'R1' && program && program.r1.total > 0 ? program : null;
  return (
    <li className={s.stage}>
      <span className={s.stageNumber} aria-hidden="true">
        {formatNumber(number)}
      </span>
      <article className={`${s.card} ${stage.state === 'active' ? s.stageActive : ''}`} aria-label={`Stage ${number}`}>
        <p className={s.itemTitle} dir="auto">
          {stage.titleFa || stage.id}
        </p>
        <div className={s.badges}>
          <Badge appearance="filled" color={state.color}>
            {state.label}
          </Badge>
          {stage.release && (
            <Badge appearance="outline" color="informative">
              {stage.release}
            </Badge>
          )}
          {stage.whenFa && (
            <span className={s.muted} dir="auto">
              {stage.whenFa}
            </span>
          )}
        </div>
        {stage.itemsFa.length > 0 && (
          <ul className={s.issues}>
            {stage.itemsFa.map((item) => (
              <li key={item} className={s.issue} dir="auto">
                {item}
              </li>
            ))}
          </ul>
        )}
        {live && (
          <TaskBar
            counts={live.r1.counts}
            total={live.r1.total}
            label={`${stage.programWave} tasks, ${formatNumber(live.r1.counts.done ?? 0)} of ${formatNumber(live.r1.total)} merged`}
          />
        )}
        {stage.total > 0 && (
          <>
            <Progress label={`${stage.titleFa || stage.id}, issues: ${stage.percent}%`} percent={stage.percent} />
            <p
              className={s.muted}
            >{`Issues: ${formatNumber(stage.counts.done)} of ${formatNumber(stage.total)} closed`}</p>
          </>
        )}
        {stage.gateFa && (
          <p className={s.gate} dir="auto">
            <span className={s.itemTitle}>Gate: </span>
            {stage.gateFa}
          </p>
        )}
        {stage.noteFa && (
          <p className={s.text} dir="auto">
            {stage.noteFa}
          </p>
        )}
        <Decisions decisions={stage.decisions} />
        {stage.sourceIds.length > 0 && (
          <div className={s.badges}>
            <span className={s.muted}>From:</span>
            <SourceBadges ids={stage.sourceIds} sources={sources} />
          </div>
        )}
      </article>
    </li>
  );
}

function Notes({
  title,
  notes,
  sources,
}: {
  title: string;
  notes: readonly DirectionNote[];
  sources: readonly PlanSource[];
}) {
  const s = useStyles();
  if (notes.length === 0) return null;
  return (
    <div className={s.column} role="group" aria-label={title}>
      <h3 className={s.columnTitle}>{title}</h3>
      {notes.map((note) => (
        <article key={note.titleFa} className={s.card}>
          <p className={s.itemTitle} dir="auto">
            {note.titleFa}
          </p>
          {note.whyFa && (
            <p className={s.text} dir="auto">
              {note.whyFa}
            </p>
          )}
          <div className={s.badges}>
            <SourceBadges ids={note.sourceIds} sources={sources} />
          </div>
        </article>
      ))}
    </div>
  );
}

/** The single direction: every stage in order, then what comes later and what is parked. */
function DirectionView({
  direction,
  program,
  sources,
}: {
  direction: Direction;
  program: Program | null;
  sources: readonly PlanSource[];
}) {
  const s = useStyles();
  return (
    <section className={s.section} aria-label="Direction">
      <h2 className={s.heading} dir="auto">
        {direction.titleFa || 'Direction'}
      </h2>
      {direction.statusFa && (
        <p className={s.text} dir="auto">
          {direction.statusFa}
        </p>
      )}
      <Decisions decisions={direction.decisions} />
      <ol className={s.stages}>
        {direction.stages.map((stage, index) => (
          <Stage key={stage.id} stage={stage} number={index + 1} program={program} sources={sources} />
        ))}
      </ol>
      <div className={s.columns}>
        <Notes title="Later" notes={direction.later} sources={sources} />
        <Notes title="Parked" notes={direction.parked} sources={sources} />
      </div>
    </section>
  );
}

/** The X gaps program's R1, lane by lane: what each is doing now and next, its phases, and what waits on the founder. */
function ProgramView({ program }: { program: Program }) {
  const s = useStyles();
  const issueUrl = (n: number) => `https://github.com/pirdehi/xomoni/issues/${n}`;
  const prUrl = (n: number) => `https://github.com/pirdehi/xomoni/pull/${n}`;
  return (
    <section className={s.section} aria-label="X gaps program, R1">
      <h2 className={s.heading} dir="auto">
        {`${program.name || 'X gaps program'} · R1`}
      </h2>
      <p className={s.muted} dir="auto">
        {program.updatedFa}
      </p>
      {program.staleCount > 0 && (
        <p className={s.gate} role="note">
          {`${plural(program.staleCount, 'task')} merged on GitHub still show as open in the program; its session updates them.`}
        </p>
      )}
      <TaskBar
        counts={program.r1.counts}
        total={program.r1.total}
        label={`R1 tasks, ${formatNumber(program.r1.counts.done ?? 0)} of ${formatNumber(program.r1.total)} merged`}
      />
      {program.releaseFa && (
        <p className={s.text} dir="auto">
          {program.releaseFa}
        </p>
      )}
      <div className={s.columns}>
        {program.lanes.map((lane) => (
          <article key={lane.id} className={s.card}>
            <p className={s.itemTitle} dir="auto">
              {lane.nameFa || lane.id}
            </p>
            <TaskBar counts={lane.counts} total={lane.total} label={lane.nameFa || lane.id} />
            {lane.doingNowFa && (
              <p className={s.text} dir="auto">
                {lane.doingNowFa}
              </p>
            )}
            {lane.nextFa.length > 0 && (
              <ol className={s.issues} aria-label="Next">
                {lane.nextFa.map((next) => (
                  <li key={next} className={s.issue} dir="auto">
                    {next}
                  </li>
                ))}
              </ol>
            )}
            {lane.phases.length > 0 && (
              <ul className={s.issues} aria-label="Phases">
                {lane.phases.map((phase) => (
                  <li key={phase.id} className={s.issue}>
                    {phase.issue !== null ? (
                      <a href={issueUrl(phase.issue)} target="_blank" rel="noopener noreferrer" className={s.link}>
                        {`${phase.id} #${phase.issue}`}
                      </a>
                    ) : (
                      phase.id
                    )}{' '}
                    <span dir="auto">{phase.nameFa}</span>
                    {` · ${formatNumber(phase.counts.done ?? 0)} of ${formatNumber(phase.total)} merged`}
                    {phase.closed && ' · closed'}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <div className={s.columns}>
        {program.founder.length > 0 && (
          <div className={s.column} role="group" aria-label="The program waits on you for">
            <h3 className={s.columnTitle}>Waits on you</h3>
            <ul className={s.issues}>
              {program.founder.map((f) => (
                <li key={f.whatFa} className={s.issue}>
                  {f.pr !== null && (
                    <a href={prUrl(f.pr)} target="_blank" rel="noopener noreferrer" className={s.link}>
                      {`#${f.pr}`}
                    </a>
                  )}{' '}
                  <span dir="auto">{f.whatFa}</span>
                  {f.blocksFa && (
                    <span className={s.muted} dir="auto">
                      {` · ${f.blocksFa}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {program.merged.length > 0 && (
          <div className={s.column} role="group" aria-label="Merged lately">
            <h3 className={s.columnTitle}>Merged lately</h3>
            <ul className={s.issues}>
              {program.merged.map((m) => (
                <li key={`${m.pr ?? ''}-${m.titleFa}`} className={s.issue}>
                  {m.pr !== null && (
                    <a href={prUrl(m.pr)} target="_blank" rel="noopener noreferrer" className={s.link}>
                      {`#${m.pr}`}
                    </a>
                  )}{' '}
                  <span dir="auto">{m.titleFa}</span>
                  {m.dateFa && <span className={s.muted} dir="auto">{` · ${m.dateFa}`}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

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
 * The console's roadmap (#516): the maintainer's private plan as their own tool last published it (the documents it is
 * built from; the single direction, stage by stage, with the X gaps program's live R1 counts; R1 lane by lane; Now,
 * Next and Later with progress and issues; objectives and key results; what waits on the founder; the public roadmap's phases; a few
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
      {plan.sources.length > 0 && <Sources sources={plan.sources} />}

      {plan.direction && <DirectionView direction={plan.direction} program={plan.program} sources={plan.sources} />}

      {plan.program && <ProgramView program={plan.program} />}

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
