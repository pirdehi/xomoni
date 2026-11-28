// The maintainer's private plan, as their own tool publishes it to `public.product_plan` (#516). The tool is outside
// this repository and may add, rename or drop fields, so every reader here tolerates a missing or odd field.
import {
  asArray,
  asBoolean,
  asCounts,
  asNullableNumber,
  asNullableString,
  asNumber,
  asObject,
  asString,
  asStringList,
} from './json';

/** An issue in a plan item's list. */
export interface PlanIssue {
  /** The GitHub issue number, when there is one. */
  readonly number: number | null;
  /** Its title. */
  readonly title: string;
  /** Its status, such as `done` or `todo`. */
  readonly status: string;
  /** Its address, only when it is on GitHub. */
  readonly url: string | null;
}

/** Issue counts of a plan item by where they stand. */
export interface ItemCounts {
  readonly done: number;
  readonly review: number;
  readonly progress: number;
  readonly founder: number;
  readonly todo: number;
  readonly dropped: number;
}

/** One item of a horizon (now, next or later). Its words are Persian and shown as they come. */
export interface PlanItem {
  /** The item's id. */
  readonly id: string;
  /** Its title (Persian). */
  readonly titleFa: string;
  /** Why it matters (Persian). */
  readonly whyFa: string;
  /** The lane it belongs to. */
  readonly lane: string;
  /** Where it stands. */
  readonly state: string;
  /** Its issues by status. */
  readonly counts: ItemCounts;
  /** How many issues it has. */
  readonly total: number;
  /** How far along it is, 0 to 100. */
  readonly percent: number;
  /** Its issues. */
  readonly issues: readonly PlanIssue[];
}

/** A key result of an objective. */
export interface KeyResult {
  readonly id: string;
  /** What is measured (Persian). */
  readonly titleFa: string;
  /** The target, when set. */
  readonly target: number | null;
  /** The unit, such as `%` or `users`. */
  readonly unit: string;
  /** `up` when more is better, `down` when less is. */
  readonly direction: string;
  /** The value now, when measured. */
  readonly value: number | null;
  /** Whether the tool measures it by itself. */
  readonly auto: boolean;
}

/** An objective and its key results. */
export interface Objective {
  readonly id: string;
  readonly title: string;
  readonly titleFa: string;
  readonly keyResults: readonly KeyResult[];
}

/** A phase of the public roadmap, with its tasks counted by status. */
export interface Phase {
  readonly number: number | null;
  readonly title: string;
  readonly state: string;
  readonly counts: {
    readonly done: number;
    readonly progress: number;
    readonly todo: number;
    readonly waiting: number;
    readonly dropped: number;
  };
  readonly total: number;
}

/** A decision or task waiting on the founder. */
export interface FounderItem {
  readonly title: string;
  readonly titleFa: string;
  /** How long it has waited, in days. */
  readonly ageDays: number | null;
  /** Where to act on it, only when it is a web address. */
  readonly link: string | null;
  /** What waiting on it holds up. */
  readonly impact: string;
}

/** How work flows: pull requests and how long they take. Each number is null when the tool didn't measure it. */
export interface Flow {
  readonly openPRs: number | null;
  readonly mergedLast7: number | null;
  readonly leadTimeHours: number | null;
  readonly failing: number | null;
  readonly conflicts: number | null;
}

/** A lane of work and its open pull requests against its limit. */
export interface Lane {
  readonly id: string;
  readonly nameFa: string;
  readonly openPrs: number;
  readonly limit: number | null;
  readonly overLimit: boolean;
}

/** A document the plan is built from, such as the X gaps program or the brand engine. */
export interface PlanSource {
  readonly id: string;
  /** Its name (Persian). */
  readonly titleFa: string;
  /** Its address, only when it is a web address. */
  readonly url: string | null;
}

/** A founder decision a stage waits on, and whether it is made. */
export interface StageDecision {
  readonly id: string;
  /** What is decided (Persian). */
  readonly titleFa: string;
  /** Whether the founder has made it. */
  readonly done: boolean;
}

/** One stage of the single direction the product follows, in order. Its words are Persian. */
export interface DirectionStage {
  readonly id: string;
  readonly titleFa: string;
  /** When it runs, in words. */
  readonly whenFa: string;
  /** The release it ships in, when it has one. */
  readonly release: string | null;
  /** `active`, `next`, `planned` or `waiting-decision`. */
  readonly state: string;
  /** What it delivers. */
  readonly itemsFa: readonly string[];
  /** What has to be true before the next stage starts. */
  readonly gateFa: string;
  readonly noteFa: string;
  /** The ids of the sources it comes from. */
  readonly sourceIds: readonly string[];
  /** Its issues by status, as a plan item counts them. */
  readonly counts: ItemCounts;
  readonly total: number;
  readonly percent: number;
  readonly issues: readonly PlanIssue[];
  /** The decisions it waits on. */
  readonly decisions: readonly StageDecision[];
  /** The X gaps program wave it is, such as `R1`, whose live task counts the page shows with it. */
  readonly programWave: string | null;
}

/** Work kept for after the direction's stages, or parked, and why. */
export interface DirectionNote {
  readonly titleFa: string;
  readonly whyFa: string;
  readonly sourceIds: readonly string[];
}

/** The single direction: the stages the product goes through, in order, and what waits or is parked. */
export interface Direction {
  readonly titleFa: string;
  /** Where the direction stands: proposed, approved, and on what. */
  readonly statusFa: string;
  /** The decisions the whole direction waits on. */
  readonly decisions: readonly StageDecision[];
  readonly stages: readonly DirectionStage[];
  readonly later: readonly DirectionNote[];
  readonly parked: readonly DirectionNote[];
}

/** Tasks counted by state: `done`, `ci`, `now`, `ready`, `todo` and `you` (waiting on the founder). */
export type TaskCounts = Readonly<Record<string, number>>;

/** A phase of the X gaps program within a lane, tied to its GitHub issue. */
export interface ProgramPhase {
  readonly id: string;
  readonly nameFa: string;
  readonly issue: number | null;
  /** Whether its issue is closed on GitHub. */
  readonly closed: boolean;
  readonly counts: TaskCounts;
  readonly total: number;
}

/** A lane of the X gaps program: one agent's line of work, and what it does now and next. */
export interface ProgramLane {
  readonly id: string;
  readonly nameFa: string;
  /** The lane's agent's state, such as `now` or `ci`. */
  readonly agent: string;
  readonly doingNowFa: string;
  readonly nextFa: readonly string[];
  readonly counts: TaskCounts;
  readonly total: number;
  readonly phases: readonly ProgramPhase[];
}

/** The X gaps program's first release (R1), task by task, as its coordinating session last wrote it. */
export interface Program {
  readonly name: string;
  /** When the program's state was written, in words. */
  readonly updatedFa: string;
  readonly releaseFa: string;
  /** Each task state's name (Persian). */
  readonly labels: Readonly<Record<string, string>>;
  /** R1's tasks: how many in all, and by state. */
  readonly r1: { readonly total: number; readonly counts: TaskCounts };
  readonly lanes: readonly ProgramLane[];
  /** What the program waits on the founder for. */
  readonly founder: readonly { readonly pr: number | null; readonly whatFa: string; readonly blocksFa: string }[];
  /** Pull requests merged lately. */
  readonly merged: readonly { readonly pr: number | null; readonly dateFa: string; readonly titleFa: string }[];
  /** Tasks the program still shows as open though GitHub has merged their pull request. */
  readonly staleCount: number;
}

/** The task states in the order the program moves through them, for bars and legends. */
export const TASK_STATES = ['done', 'ci', 'now', 'ready', 'todo', 'you'] as const;

/** The plan as the console's roadmap page shows it. */
export interface ProductPlan {
  /** When the tool built it. */
  readonly generatedAt: string | null;
  /** The newest release and what is waiting for the next. */
  readonly release: { readonly latest: string | null; readonly pending: readonly string[] };
  /** Features in all, by status and by area. */
  readonly features: {
    readonly total: number;
    readonly byStatus: Readonly<Record<string, number>>;
    readonly byArea: Readonly<Record<string, number>>;
  };
  /** The one number the product steers by, when set. */
  readonly northStar: {
    readonly title: string;
    readonly titleFa: string;
    readonly definitionFa: string;
    readonly value: number | null;
    readonly measured: string | null;
  } | null;
  readonly objectives: readonly Objective[];
  readonly horizons: {
    readonly now: readonly PlanItem[];
    readonly next: readonly PlanItem[];
    readonly later: readonly PlanItem[];
  };
  readonly phases: readonly Phase[];
  readonly founder: readonly FounderItem[];
  readonly issueCounts: Readonly<Record<string, number>>;
  readonly flow: Flow;
  readonly lanes: readonly Lane[];
  /** The single direction, when the tool publishes one. */
  readonly direction: Direction | null;
  /** The X gaps program's R1, when the tool publishes it. */
  readonly program: Program | null;
  /** The documents the plan is built from. */
  readonly sources: readonly PlanSource[];
}

/** The plan and when it was published. */
export interface PublishedPlan {
  readonly plan: ProductPlan;
  /** When the maintainer's tool last published it. */
  readonly updatedAt: string;
}

/** `value` when it is an http(s) address, so a link never runs script. */
export function webAddress(value: unknown): string | null {
  const text = asNullableString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** An id from the plan: its string or number, or the item's place in its list. */
function idOf(value: unknown, index: number): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(index);
}

function parseCounts(raw: unknown): ItemCounts {
  const c = asObject(raw);
  return {
    done: asNumber(c.done),
    review: asNumber(c.review),
    progress: asNumber(c.progress),
    founder: asNumber(c.founder),
    todo: asNumber(c.todo),
    dropped: asNumber(c.dropped),
  };
}

/** Progress as 0 to 100: `progress` as the tool gives it (a fraction or a percent), else done of all. */
function percentOf(counts: ItemCounts, total: number, progress: unknown): number {
  const given = asNullableNumber(progress);
  const fraction = given === null ? (total > 0 ? counts.done / total : 0) : given <= 1 ? given : given / 100;
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

function parseIssues(raw: unknown): PlanIssue[] {
  return asArray(raw).map((rawIssue) => {
    const issue = asObject(rawIssue);
    return {
      number: asNullableNumber(issue.number),
      title: asString(issue.title),
      status: asString(issue.status),
      url: webAddress(issue.url),
    };
  });
}

function parseItem(raw: unknown, index: number): PlanItem {
  const item = asObject(raw);
  const counts = parseCounts(item.counts);
  const total = asNumber(item.total);
  return {
    id: idOf(item.id, index),
    titleFa: asString(item.titleFa) || asString(item.title),
    whyFa: asString(item.whyFa),
    lane: asString(item.lane),
    state: asString(item.state),
    counts,
    total,
    percent: percentOf(counts, total, item.progress),
    issues: parseIssues(item.issueList),
  };
}

function parseDecisions(raw: unknown): StageDecision[] {
  return asArray(raw).map((rawDecision, index) => {
    const d = asObject(rawDecision);
    return {
      id: idOf(d.id, index),
      titleFa: asString(d.titleFa) || asString(d.title),
      done: asString(d.status) === 'done',
    };
  });
}

function parseNotes(raw: unknown): DirectionNote[] {
  return asArray(raw).map((rawNote) => {
    const n = asObject(rawNote);
    return { titleFa: asString(n.titleFa), whyFa: asString(n.whyFa), sourceIds: asStringList(n.sourceIds) };
  });
}

/** The single direction, or null when the tool publishes none. */
function parseDirection(raw: unknown): Direction | null {
  const d = asObject(raw);
  if (Object.keys(d).length === 0) return null;
  const stages = asArray(d.stages).map((rawStage, index): { order: number; stage: DirectionStage } => {
    const st = asObject(rawStage);
    const counts = parseCounts(st.counts);
    const total = asNumber(st.total);
    const stage: DirectionStage = {
      id: idOf(st.id, index),
      titleFa: asString(st.titleFa),
      whenFa: asString(st.whenFa),
      release: asNullableString(st.release),
      state: asString(st.state),
      itemsFa: asStringList(st.itemsFa),
      gateFa: asString(st.gateFa),
      noteFa: asString(st.noteFa),
      sourceIds: asStringList(st.sourceIds),
      counts,
      total,
      percent: percentOf(counts, total, st.progress),
      issues: parseIssues(st.issueList),
      decisions: parseDecisions(st.decisions),
      programWave: asNullableString(st.programWave),
    };
    return { order: asNumber(st.order, index + 1), stage };
  });
  return {
    titleFa: asString(d.titleFa),
    statusFa: asString(d.statusFa),
    decisions: parseDecisions(d.decisions),
    stages: [...stages].sort((a, b) => a.order - b.order).map(({ stage }) => stage),
    later: parseNotes(d.later),
    parked: parseNotes(d.parked),
  };
}

/** The X gaps program's R1, or null when the tool publishes none. */
function parseProgram(raw: unknown): Program | null {
  const p = asObject(raw);
  if (Object.keys(p).length === 0) return null;
  const r1 = asObject(p.r1);
  const labels = asObject(p.labels);
  return {
    name: asString(p.name),
    updatedFa: asString(p.updatedFa),
    releaseFa: asString(p.releaseFa),
    labels: Object.fromEntries(Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string')),
    r1: { total: asNumber(r1.total), counts: asCounts(r1.counts) },
    lanes: asArray(p.lanes).map((rawLane, index) => {
      const l = asObject(rawLane);
      return {
        id: idOf(l.key ?? l.id, index),
        nameFa: asString(l.nameFa),
        agent: asString(l.agent),
        doingNowFa: asString(l.doingNowFa),
        nextFa: asStringList(l.nextFa),
        counts: asCounts(l.counts),
        total: asNumber(l.total),
        phases: asArray(l.phases).map((rawPhase, phaseIndex) => {
          const ph = asObject(rawPhase);
          return {
            id: idOf(ph.id, phaseIndex),
            nameFa: asString(ph.nameFa),
            issue: asNullableNumber(ph.issue),
            closed: asString(ph.issueState) === 'closed',
            counts: asCounts(ph.counts),
            total: asNumber(ph.total),
          };
        }),
      };
    }),
    founder: asArray(p.founder).map((rawItem) => {
      const f = asObject(rawItem);
      return { pr: asNullableNumber(f.pr), whatFa: asString(f.whatFa), blocksFa: asString(f.blocksFa) };
    }),
    merged: asArray(p.merged).map((rawItem) => {
      const m = asObject(rawItem);
      return { pr: asNullableNumber(m.pr), dateFa: asString(m.dateFa), titleFa: asString(m.titleFa) };
    }),
    staleCount: asNumber(p.staleCount),
  };
}

/** Reads the published plan; whatever is missing reads as empty. */
export function parsePlan(json: unknown): ProductPlan {
  const root = asObject(json);
  const release = asObject(root.release);
  const features = asObject(root.features);
  const star = asObject(root.northStar);
  const horizons = asObject(root.horizons);
  const flow = asObject(root.flow);
  const items = (value: unknown) => asArray(value).map(parseItem);
  return {
    generatedAt: asNullableString(root.generatedAt),
    release: {
      latest: asNullableString(release.latest),
      pending: asArray(release.pending)
        .map((p) => asString(p) || asString(asObject(p).title) || asString(asObject(p).version))
        .filter((p) => p.length > 0),
    },
    features: {
      total: asNumber(features.total),
      byStatus: asCounts(features.byStatus),
      byArea: asCounts(features.byArea),
    },
    northStar:
      Object.keys(star).length === 0
        ? null
        : {
            title: asString(star.title),
            titleFa: asString(star.titleFa),
            definitionFa: asString(star.definitionFa),
            value: asNullableNumber(star.value),
            measured: asNullableString(star.measured),
          },
    objectives: asArray(root.objectives).map((raw, index) => {
      const o = asObject(raw);
      return {
        id: idOf(o.id, index),
        title: asString(o.title),
        titleFa: asString(o.titleFa),
        keyResults: asArray(o.keyResults).map((rawKr, krIndex) => {
          const kr = asObject(rawKr);
          return {
            id: idOf(kr.id, krIndex),
            titleFa: asString(kr.titleFa) || asString(kr.title),
            target: asNullableNumber(kr.target),
            unit: asString(kr.unit),
            direction: asString(kr.direction, 'up'),
            value: asNullableNumber(kr.value),
            auto: asBoolean(kr.auto),
          };
        }),
      };
    }),
    horizons: { now: items(horizons.now), next: items(horizons.next), later: items(horizons.later) },
    phases: asArray(root.phases).map((raw) => {
      const p = asObject(raw);
      const c = asObject(p.counts);
      return {
        number: asNullableNumber(p.number),
        title: asString(p.title),
        state: asString(p.state),
        counts: {
          done: asNumber(c.done),
          progress: asNumber(c.progress),
          todo: asNumber(c.todo),
          waiting: asNumber(c.waiting),
          dropped: asNumber(c.dropped),
        },
        total: asNumber(p.total),
      };
    }),
    founder: asArray(root.founder).map((raw) => {
      const f = asObject(raw);
      return {
        title: asString(f.title),
        titleFa: asString(f.titleFa),
        ageDays: asNullableNumber(f.ageDays),
        link: webAddress(f.link),
        impact: asString(f.impact),
      };
    }),
    issueCounts: asCounts(root.issueCounts),
    flow: {
      openPRs: asNullableNumber(flow.openPRs),
      mergedLast7: asNullableNumber(flow.mergedLast7),
      leadTimeHours: asNullableNumber(flow.leadTimeHours),
      failing: asNullableNumber(flow.failing),
      conflicts: asNullableNumber(flow.conflicts),
    },
    lanes: asArray(root.lanes).map((raw, index) => {
      const l = asObject(raw);
      return {
        id: idOf(l.id, index),
        nameFa: asString(l.nameFa) || asString(l.name),
        openPrs: asNumber(l.openPrs),
        limit: asNullableNumber(l.limit),
        overLimit: asBoolean(l.overLimit),
      };
    }),
    direction: parseDirection(root.direction),
    program: parseProgram(root.program),
    sources: asArray(root.sources).map((raw, index) => {
      const src = asObject(raw);
      return {
        id: idOf(src.id, index),
        titleFa: asString(src.titleFa) || asString(src.title),
        url: webAddress(src.url),
      };
    }),
  };
}

/** A phase's progress, 0 to 100: done of what wasn't dropped. */
export function phasePercent(phase: Pick<Phase, 'counts' | 'total'>): number {
  const counted = phase.total - phase.counts.dropped;
  return counted > 0 ? Math.round((phase.counts.done / counted) * 100) : 0;
}
