import type { VaultFreshness, VaultSummary, VaultSummarySource } from '@xomoni/bridge';
import type { Tone } from './job-status';

/** Each freshness in the person's words, with its tone; the same words as the extension's Vault page (#425). */
export const VAULT_FRESHNESS_WORDS: Record<VaultFreshness, { label: string; tone: Tone }> = {
  never: { label: 'Not yet', tone: 'neutral' },
  fresh: { label: 'Up to date', tone: 'good' },
  due: { label: 'Due for a new copy', tone: 'warn' },
  overdue: { label: 'Overdue', tone: 'serious' },
};

/** Each source in the person's words. */
export const VAULT_SOURCE_LABELS: Record<VaultSummarySource, string> = {
  'x-archive': 'X’s archive',
  'x-analytics-posts': 'X’s analytics of posts',
  'x-analytics-days': 'X’s analytics of days',
  'x-under-the-hood': 'X’s Under the hood',
};

/** One line of the *Your vault* card. */
export interface VaultLine {
  source: VaultSummarySource;
  label: string;
  freshness: { label: string; tone: Tone };
  /** What the vault holds of it, and from when, in words. */
  detail: string;
}

/** What the rows of a source are called, one and many. */
const ROWS: Record<VaultSummarySource, [string, string]> = {
  'x-archive': ['row', 'rows'],
  'x-analytics-posts': ['post', 'posts'],
  'x-analytics-days': ['day', 'days'],
  'x-under-the-hood': ['month', 'months'],
};

/** How old a copy from `at` is at `now`, in whole days, in words. */
function age(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? '1 day old' : `${days.toLocaleString('en-US')} days old`;
}

/**
 * The card's lines, in the order of `VAULT_SUMMARY_SOURCES`, each with its freshness and what the vault holds of it.
 * Pure: the summary comes from Xomoni in this browser, and holds counts and dates only.
 */
export function vaultLines(summary: VaultSummary, now: number): VaultLine[] {
  return summary.sources.map((s) => {
    const [one, many] = ROWS[s.source];
    const held = `${s.rows.toLocaleString('en-US')} ${s.rows === 1 ? one : many}`;
    return {
      source: s.source,
      label: VAULT_SOURCE_LABELS[s.source],
      freshness: VAULT_FRESHNESS_WORDS[s.freshness],
      detail: s.lastAt === null ? (s.rows ? held : 'Not imported yet') : `${held} · ${age(s.lastAt, now)}`,
    };
  });
}

/** Whether the vault holds nothing yet: no import, and no row in any source. */
export const vaultEmpty = (summary: VaultSummary): boolean =>
  summary.imports === 0 && summary.sources.every((s) => s.rows === 0);
