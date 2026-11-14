import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/shared/types';
import { MIN_GROUP, groupLog } from '../../src/ui/log-groups';

const AT = new Date(2026, 10, 14, 1, 30).getTime();
let seq = 0;
const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  seq: ++seq,
  ts: AT,
  accountId: 'me',
  jobId: 'job-1',
  level: 'success',
  action: 'delete',
  targetId: String(seq),
  outcome: 'done',
  message: 'Deleted',
  ...over,
});
const run = (n: number, over: Partial<LogEntry> = {}) =>
  Array.from({ length: n }, (_, i) => entry({ ts: AT - i * 60_000, ...over }));

describe('groupLog (#204)', () => {
  it('folds a run of the same confirmed action into one line, with its time span', () => {
    const rows = groupLog(run(31));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      label: 'Deleted 31 posts and replies',
      to: AT,
      from: AT - 30 * 60_000,
    });
    expect(rows[0]?.kind === 'group' && rows[0].entries).toHaveLength(31);
  });

  it('leaves runs shorter than the minimum as they are', () => {
    expect(groupLog(run(MIN_GROUP - 1)).map((r) => r.kind)).toEqual(['entry', 'entry']);
    expect(groupLog(run(MIN_GROUP)).map((r) => r.kind)).toEqual(['group']);
  });

  it('never folds warnings, errors or job events, and keeps the order', () => {
    const rows = groupLog([
      ...run(3, { level: 'warn', message: 'X rate limit hit' }),
      ...run(3, { level: 'info', action: 'system', message: 'Sweep: no more matching posts on X' }),
      ...run(4, { action: 'unlike', message: 'Unliked' }),
      entry({ level: 'error', message: 'Failed' }),
    ]);
    expect(rows.map((r) => (r.kind === 'group' ? r.label : r.entry.message))).toEqual([
      'X rate limit hit',
      'X rate limit hit',
      'X rate limit hit',
      'Sweep: no more matching posts on X',
      'Sweep: no more matching posts on X',
      'Sweep: no more matching posts on X',
      'Unliked 4 posts',
      'Failed',
    ]);
  });

  it('starts a new line for another job, another day or another action', () => {
    const rows = groupLog([
      ...run(3),
      ...run(3, { jobId: 'job-2' }),
      ...run(3, { ts: AT - 2 * 86_400_000 }),
      ...run(3, { action: 'unretweet', message: 'Undid repost' }),
    ]);
    expect(rows.map((r) => (r.kind === 'group' ? r.label : 'entry'))).toEqual([
      'Deleted 3 posts and replies',
      'Deleted 3 posts and replies',
      'Deleted 3 posts and replies',
      'Undid repost 3 reposts',
    ]);
  });

  it('gives each group a key of its own', () => {
    const keys = groupLog([...run(3), ...run(3, { jobId: 'job-2' })]).map((r) => (r.kind === 'group' ? r.key : ''));
    expect(new Set(keys).size).toBe(2);
  });
});
