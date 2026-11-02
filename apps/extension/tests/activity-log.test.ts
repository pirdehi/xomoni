import { describe, expect, it } from 'vitest';
import { ACTIVITY_COLUMNS, activityCsv, activityJson, csvCell, entryUrl } from '../src/shared/activity-log';
import type { LogEntry } from '../src/shared/types';

const T0 = Date.UTC(2024, 4, 1, 10);
const entry = (over: Partial<LogEntry>): LogEntry => ({
  ts: T0,
  accountId: 'acct-1',
  jobId: 'job-1',
  level: 'success',
  action: 'delete',
  targetId: '111',
  outcome: 'done',
  message: 'Deleted',
  ...over,
});

describe('the activity log export (#34)', () => {
  it('links an entry to its post, and job events to nothing', () => {
    expect(entryUrl({ targetId: '111' })).toBe('https://x.com/i/web/status/111');
    expect(entryUrl({ targetId: null })).toBeNull();
  });

  it('quotes CSV fields with quotes, commas or line breaks, and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('X said "no"')).toBe('"X said ""no"""');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('writes a header and one row per entry, oldest first', () => {
    const csv = activityCsv([
      entry({ ts: T0 + 1000 }),
      entry({ ts: T0, level: 'info', action: 'system', targetId: null, outcome: null, message: 'Started' }),
    ]);
    expect(csv.split('\n')).toEqual([
      ACTIVITY_COLUMNS.join(','),
      '2024-05-01T10:00:00.000Z,info,system,,,,job-1,Started',
      '2024-05-01T10:00:01.000Z,success,delete,done,111,https://x.com/i/web/status/111,job-1,Deleted',
    ]);
  });

  it('writes JSON with the format, the account, the export time and every entry oldest first', () => {
    const data: unknown = JSON.parse(
      activityJson({ id: 'acct-1', handle: 'me' }, [entry({ ts: T0 + 1 }), entry({ ts: T0, outcome: 'skipped' })], T0),
    );
    expect(data).toEqual({
      format: 'xomoni-activity',
      version: 1,
      account: { id: 'acct-1', handle: 'me' },
      exportedAt: '2024-05-01T10:00:00.000Z',
      entries: [
        expect.objectContaining({ time: '2024-05-01T10:00:00.000Z', outcome: 'skipped', postId: '111' }),
        expect.objectContaining({ time: '2024-05-01T10:00:00.001Z', outcome: 'done' }),
      ],
    });
  });
});
