// Reach on xomoni.com (#431, ADR-0045, ADR-0028): what the page says about Xomoni's `reach` answer, read in the same
// browser and kept in the page's memory only. The verdicts and the guess box use the same words as the extension
// (`REACH_VERDICT_WORDS`, `REACH_GUESS_NOTICE`); every suspected post is a guess. Pure.
import {
  REACH_VERDICT_WORDS,
  type ReachComparisonSummary,
  type ReachMonthSummary,
  type ReachOrder,
  type ReachPostSummary,
  type ReachRange,
  type ReachSummary,
} from '@xomoni/bridge';
import { type Cell, toCsv } from './reports';

/** What each order is called on the page. */
export const REACH_ORDER_WORDS: Readonly<Record<ReachOrder, string>> = {
  recent: 'Newest',
  best: 'Most seen',
  worst: 'Least seen',
};

/** What a period is called on the page: "Last 30 days", "Last 90 days", "Last year" or "Everything". */
export function rangeWords(range: ReachRange): string {
  if (range === null) return 'Everything';
  return range === 365 ? 'Last year' : `Last ${String(range)} days`;
}

/**
 * Whether a period goes past the free 30 days: Reach's longer history is part of Plus, open as a preview until sales
 * start (ADR-0042), as in the extension.
 */
export const rangeIsPlus = (range: ReachRange) => range !== 30;

/** What each comparison is about, and how its two sides read in a sentence. */
const COMPARISON_WORDS: Readonly<
  Record<ReachComparisonSummary['id'], { title: string; groups: [string, string]; subjects: [string, string] }>
> = {
  links: {
    title: 'Posts with a link, against posts without',
    groups: ['With a link', 'Without'],
    subjects: ['posts with a link', 'posts without'],
  },
  media: {
    title: 'Posts with photos or videos, against text only',
    groups: ['With photos or videos', 'Text only'],
    subjects: ['posts with photos or videos', 'text-only posts'],
  },
  premium: {
    title: 'With Premium, against before it',
    groups: ['With Premium', 'Before'],
    subjects: ['posts with Premium', 'posts before it'],
  },
};

/** A ratio as a share: 0.52 is "52%". */
export const shareWords = (ratio: number) => `${Math.round(ratio * 100).toLocaleString('en-US')}%`;

/** A comparison as the page shows it: its title, its two sides' names, its verdict in words, and its sentence. */
export interface ComparisonView {
  id: ReachComparisonSummary['id'];
  title: string;
  groups: readonly [string, string];
  verdict: string;
  /** "Posts with a link were seen 52% as much as posts without (95% interval 41% to 66%)"; null without the numbers. */
  sentence: string | null;
}

/** A comparison of Xomoni's answer, in the page's words. */
export function comparisonView(c: ReachComparisonSummary): ComparisonView {
  const words = COMPARISON_WORDS[c.id];
  const [first, second] = words.subjects;
  const sentence =
    c.verdict === 'not-enough-data' || c.ratio === null || c.low === null || c.high === null
      ? null
      : `${first.charAt(0).toUpperCase()}${first.slice(1)} were seen ${shareWords(c.ratio)} as much as ${second} (95% interval ${shareWords(c.low)} to ${shareWords(c.high)}).`;
  return { id: c.id, title: words.title, groups: words.groups, verdict: REACH_VERDICT_WORDS[c.verdict], sentence };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A `yyyy-mm` month in words: "July 2026". */
export function monthWords(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? month} ${year ?? ''}`.trim();
}

/** What a month says when it has no table of labels: not eligible, or no labels (never "clean"); null with labels. */
export function monthNote(m: ReachMonthSummary): string | null {
  if (m.eligible === false) return "X says the account wasn't eligible for that month's report.";
  if (!m.labels.length)
    return m.postsInMonth === null
      ? 'No labels that month.'
      : `No labels that month, across ${m.postsInMonth.toLocaleString('en-US')} posts.`;
  return null;
}

/** A post's address on X. */
export const postUrl = (id: string, handle: string) =>
  handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`;

/** A post's share of usual in words: "48% of usual", or "—" without one. */
export const vsUsualWords = (ratio: number | null) => (ratio === null ? '—' : `${shareWords(ratio)} of usual`);

/** The posts shown, as CSV a spreadsheet can't run: a header, then one row per post. */
export function reachPostsCsv(posts: readonly ReachPostSummary[], handle: string): string {
  const rows: Cell[][] = [
    ['date', 'text', 'seen', 'source', 'share of usual', 'link'],
    ...posts.map((p): Cell[] => [
      new Date(p.createdAt).toISOString().slice(0, 10),
      p.text,
      p.impressions,
      p.source === 'csv' ? "X's analytics export" : 'views Xomoni saw',
      p.vsUsual === null ? null : Math.round(p.vsUsual * 100) / 100,
      postUrl(p.id, handle),
    ]),
  ];
  return toCsv(rows);
}

/** Whether an answer has anything to show: a post with a number, or a month of X's report. */
export const hasReach = (summary: Pick<ReachSummary, 'csv' | 'live' | 'months'>) =>
  summary.csv + summary.live > 0 || summary.months.length > 0;
