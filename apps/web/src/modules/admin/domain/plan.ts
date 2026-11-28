// The maintainer's private plan, as their own tool publishes it to `public.product_plan` (#516). The tool is outside
// this repository and may add, rename or drop fields, so every reader here tolerates a missing or odd field.
import { asArray, asBoolean, asCounts, asNullableNumber, asNullableString, asNumber, asObject, asString } from './json';

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

function parseItem(raw: unknown, index: number): PlanItem {
  const item = asObject(raw);
  const c = asObject(item.counts);
  const counts: ItemCounts = {
    done: asNumber(c.done),
    review: asNumber(c.review),
    progress: asNumber(c.progress),
    founder: asNumber(c.founder),
    todo: asNumber(c.todo),
    dropped: asNumber(c.dropped),
  };
  const total = asNumber(item.total);
  const given = asNullableNumber(item.progress);
  const fraction = given === null ? (total > 0 ? counts.done / total : 0) : given <= 1 ? given : given / 100;
  return {
    id: idOf(item.id, index),
    titleFa: asString(item.titleFa) || asString(item.title),
    whyFa: asString(item.whyFa),
    lane: asString(item.lane),
    state: asString(item.state),
    counts,
    total,
    percent: Math.round(Math.min(1, Math.max(0, fraction)) * 100),
    issues: asArray(item.issueList).map((rawIssue) => {
      const issue = asObject(rawIssue);
      return {
        number: asNullableNumber(issue.number),
        title: asString(issue.title),
        status: asString(issue.status),
        url: webAddress(issue.url),
      };
    }),
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
  };
}

/** A phase's progress, 0 to 100: done of what wasn't dropped. */
export function phasePercent(phase: Pick<Phase, 'counts' | 'total'>): number {
  const counted = phase.total - phase.counts.dropped;
  return counted > 0 ? Math.round((phase.counts.done / counted) * 100) : 0;
}
