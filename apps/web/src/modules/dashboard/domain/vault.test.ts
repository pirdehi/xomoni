import type { VaultSummary } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import { VAULT_FRESHNESS_WORDS, VAULT_SOURCE_LABELS, vaultEmpty, vaultLines } from './vault';

// The *Your vault* card's words (#426): freshness, sources and what each holds, from counts and dates only.

const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 86_400_000;

const summary = (over: Partial<VaultSummary> = {}): VaultSummary => ({
  handle: 'xomoni_fixture',
  sources: [
    { source: 'x-archive', lastAt: NOW - 40 * DAY, freshness: 'due', rows: 1500 },
    { source: 'x-analytics-posts', lastAt: NOW - DAY, freshness: 'fresh', rows: 1 },
    { source: 'x-analytics-days', lastAt: null, freshness: 'never', rows: 0 },
  ],
  archiveGeneratedAt: NOW - 40 * DAY,
  imports: 2,
  captureGroupsOn: 0,
  ...over,
});

describe('the vault card’s words', () => {
  it('says each source, its freshness, what it holds and how old it is', () => {
    expect(vaultLines(summary(), NOW)).toEqual([
      {
        source: 'x-archive',
        label: 'X’s archive',
        freshness: { label: 'Due for a new copy', tone: 'warn' },
        detail: '1,500 rows · 40 days old',
      },
      {
        source: 'x-analytics-posts',
        label: 'X’s analytics of posts',
        freshness: { label: 'Up to date', tone: 'good' },
        detail: '1 post · 1 day old',
      },
      {
        source: 'x-analytics-days',
        label: 'X’s analytics of days',
        freshness: { label: 'Not yet', tone: 'neutral' },
        detail: 'Not imported yet',
      },
    ]);
  });

  it('says today for a copy from today, and the rows of a source with no date', () => {
    const [line] = vaultLines(
      summary({ sources: [{ source: 'x-analytics-days', lastAt: NOW - 1000, freshness: 'fresh', rows: 7 }] }),
      NOW,
    );
    expect(line?.detail).toBe('7 days · today');
    const [undated] = vaultLines(
      summary({ sources: [{ source: 'x-under-the-hood', lastAt: null, freshness: 'never', rows: 3 }] }),
      NOW,
    );
    expect(undated?.detail).toBe('3 months');
  });

  it('knows an empty vault', () => {
    expect(vaultEmpty(summary())).toBe(false);
    expect(
      vaultEmpty(
        summary({ imports: 0, sources: [{ source: 'x-archive', lastAt: null, freshness: 'never', rows: 0 }] }),
      ),
    ).toBe(true);
  });

  it('names every freshness and source', () => {
    expect(Object.keys(VAULT_FRESHNESS_WORDS)).toEqual(['never', 'fresh', 'due', 'overdue']);
    expect(VAULT_FRESHNESS_WORDS.overdue.tone).toBe('serious');
    expect(Object.keys(VAULT_SOURCE_LABELS)).toHaveLength(4);
  });
});
