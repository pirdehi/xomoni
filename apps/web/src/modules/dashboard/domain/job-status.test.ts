import { describe, expect, it } from 'vitest';
import { isOnline, jobProgress, jobStateView, ONLINE_WINDOW_MS, relativeTime, upsertNewestFirst } from './job-status';

describe('jobProgress', () => {
  it('counts done, skipped and failed against matched', () => {
    expect(jobProgress({ kind: 'cleanup', matched: 200, done: 90, skipped: 8, failed: 2 })).toBe(50);
  });

  it('caps at 100 and has no value for scans or empty jobs', () => {
    expect(jobProgress({ kind: 'cleanup', matched: 10, done: 12, skipped: 0, failed: 0 })).toBe(100);
    expect(jobProgress({ kind: 'scan', matched: 10, done: 5, skipped: 0, failed: 0 })).toBeNull();
    expect(jobProgress({ kind: 'cleanup', matched: 0, done: 0, skipped: 0, failed: 0 })).toBeNull();
  });
});

describe('jobStateView', () => {
  it('uses the extension wording', () => {
    expect(jobStateView('waiting')).toEqual({ label: 'Needs you', tone: 'serious' });
    expect(jobStateView('blocked').label).toBe('Stopped for safety');
  });

  it('shows states from newer extensions as-is', () => {
    expect(jobStateView('throttled')).toEqual({ label: 'throttled', tone: 'neutral' });
  });
});

describe('isOnline', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  it('is online inside the window only', () => {
    expect(isOnline({ lastSeenAt: new Date(now - ONLINE_WINDOW_MS + 1000).toISOString() }, now)).toBe(true);
    expect(isOnline({ lastSeenAt: new Date(now - ONLINE_WINDOW_MS - 1000).toISOString() }, now)).toBe(false);
  });
});

describe('upsertNewestFirst', () => {
  it('replaces by id and keeps newest first', () => {
    const list = [
      { id: 'a', at: '2026-10-31T10:00:00Z' },
      { id: 'b', at: '2026-10-31T09:00:00Z' },
    ];
    expect(upsertNewestFirst(list, { id: 'b', at: '2026-10-31T11:00:00Z' }, 'at').map((x) => x.id)).toEqual(['b', 'a']);
    expect(upsertNewestFirst(list, { id: 'c', at: '2026-10-31T08:00:00Z' }, 'at').map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  it('rounds to the nearest sensible unit', () => {
    expect(relativeTime('2026-10-31T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-10-31T11:55:00Z', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-31T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-30T12:00:00Z', now)).toBe('yesterday');
  });
});
