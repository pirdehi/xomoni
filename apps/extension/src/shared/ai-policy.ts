// X's AI policy windows (#518, P6.1.3, the AI exposure audit's ADR): the spans in which X's own words allowed AI
// training on what people post there, each with the source it was read from and how sure that source is. Data only:
// it changes by pull request, nothing is fetched to build it, and a test fails on a window without an https source.
// Nothing here says any one post was used; only that X's terms allowed it while the post was public.

/** Day in `yyyy-mm-dd` form, UTC, as policies give their effective dates. */
export type PolicyDay = string;

/** One place a window's dates were read: an https address, its title, and the day it was read. */
export interface PolicySource {
  url: string;
  title: string;
  /** The day the source was read, `yyyy-mm-dd`. */
  accessed: PolicyDay;
}

/** What a window allows AI training on: the person's public posts, or what they send to Grok and what it answers. */
export type PolicyTarget = 'public-posts' | 'grok-prompts';

/**
 * How sure a window's dates are: `confirmed` when read in the policy's own text or an archived copy of it, `reported`
 * when only a reliable report says so.
 */
export type PolicyConfidence = 'confirmed' | 'reported';

/** A span in which X's own words allowed AI training on something the person posted or sent. */
export interface PolicyWindow {
  id: string;
  /** Whose training it allows: X's own models, or those of the third parties X shares data with. */
  scope: 'x' | 'third-party';
  /** What the person reads for it. */
  label: string;
  /** The first day it applied, `yyyy-mm-dd`. */
  from: PolicyDay;
  /** The last day it applied, or null while it still does. */
  to: PolicyDay | null;
  appliesTo: PolicyTarget;
  /** Whether X's words give the person a way to opt out of it, so their own opt-out day ends it for them. */
  optOut: boolean;
  sources: readonly PolicySource[];
  confidence: PolicyConfidence;
}

/** Open Terms Archive's copies of X's policies, in the Platform Governance Archive: X's own text, kept by date. */
const OTA = 'https://github.com/OpenTermsArchive/pga-versions/blob';

/**
 * X's AI policy windows, oldest first. Each was read on 28 November 2026 in X's own text, as archived by Open Terms
 * Archive (x.com's own pages refuse automated reads):
 * - from 29 September 2023, X's privacy policy says it may use what it collects and publicly available information to
 *   help train its machine learning or artificial intelligence models;
 * - from 15 November 2024, X's privacy policy says third-party collaborators may, unless the person opts out, use
 *   their information to train their own AI models;
 * - from 15 January 2026, X's terms count "inputs, prompts, outputs" as the person's Content, which the terms'
 *   license lets X use for training its AI models.
 */
export const AI_POLICY_WINDOWS: readonly PolicyWindow[] = [
  {
    id: 'x-models-public',
    scope: 'x',
    label: 'X may train its own AI models on public posts',
    from: '2023-09-29',
    to: null,
    appliesTo: 'public-posts',
    optOut: false,
    sources: [
      {
        url: `${OTA}/7d8a1c2c944fbdcfdec8d829e804e731aa9bdff5/X/Privacy%20Policy.md`,
        title: 'X Privacy Policy, effective September 29, 2023 (archived by Open Terms Archive)',
        accessed: '2026-11-28',
      },
    ],
    confidence: 'confirmed',
  },
  {
    id: 'third-party-public',
    scope: 'third-party',
    label: 'Third parties X shares data with may train their AI models, unless you opt out',
    from: '2024-11-15',
    to: null,
    appliesTo: 'public-posts',
    optOut: true,
    sources: [
      {
        url: `${OTA}/969b4a44ab4a2f0f0e51c5a191fb0848c7775008/X/Privacy%20Policy.md`,
        title: 'X Privacy Policy, effective November 15, 2024 (archived by Open Terms Archive)',
        accessed: '2026-11-28',
      },
    ],
    confidence: 'confirmed',
  },
  {
    id: 'x-models-grok-prompts',
    scope: 'x',
    label: 'What you send to Grok, and what it answers, counts as your content under X’s terms',
    from: '2026-01-15',
    to: null,
    appliesTo: 'grok-prompts',
    optOut: false,
    sources: [
      {
        url: `${OTA}/89a35f6f1b52efc62b91cebdaa3f3eb4e39e4243/X/Terms%20of%20Service.md`,
        title: 'X Terms of Service, effective January 15, 2026 (archived by Open Terms Archive)',
        accessed: '2026-11-28',
      },
    ],
    confidence: 'confirmed',
  },
];

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `day` is a real `yyyy-mm-dd` day. */
export function isPolicyDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

/**
 * What is wrong with `windows`, in words; empty when nothing is. Each window needs a unique id, real days with `from`
 * no later than `to`, and at least one source with an https address, a title and the day it was read; two windows of
 * the same scope and target may not overlap.
 */
export function policyWindowProblems(windows: readonly PolicyWindow[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const w of windows) {
    if (ids.has(w.id)) problems.push(`${w.id}: the id is used twice`);
    ids.add(w.id);
    if (!isPolicyDay(w.from)) problems.push(`${w.id}: from is not a day`);
    if (w.to !== null && !isPolicyDay(w.to)) problems.push(`${w.id}: to is not a day`);
    if (w.to !== null && w.to < w.from) problems.push(`${w.id}: it ends before it starts`);
    if (!w.sources.length) problems.push(`${w.id}: it has no source`);
    for (const s of w.sources) {
      if (!s.url.startsWith('https://')) problems.push(`${w.id}: a source is not https`);
      if (!s.title.trim()) problems.push(`${w.id}: a source has no title`);
      if (!isPolicyDay(s.accessed)) problems.push(`${w.id}: a source has no day it was read`);
    }
  }
  for (const [i, a] of windows.entries()) {
    for (const b of windows.slice(i + 1)) {
      if (a.scope !== b.scope || a.appliesTo !== b.appliesTo) continue;
      const aEnd = a.to ?? '9999-12-31';
      const bEnd = b.to ?? '9999-12-31';
      if (a.from <= bEnd && b.from <= aEnd) problems.push(`${a.id} and ${b.id} overlap`);
    }
  }
  return problems;
}

/** The windows in force on `day` (`yyyy-mm-dd`). */
export function windowsOn(day: PolicyDay, windows: readonly PolicyWindow[] = AI_POLICY_WINDOWS): PolicyWindow[] {
  return windows.filter((w) => w.from <= day && (w.to === null || day <= w.to));
}
