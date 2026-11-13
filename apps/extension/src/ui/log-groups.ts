// The Activity log, readable (#204): a run of the same confirmed action within one job and one day reads as one line,
// such as "Deleted 31 posts and replies, 01:01–01:32", which opens to its entries. Warnings, errors and job events are
// never folded away. Pure, so the grouping is tested without drawing the list.
import type { ActionKind, LogEntry } from '../shared/types';

/** Shorter runs stay as they are: grouping two lines saves nothing. */
export const MIN_GROUP = 3;

/** What each action acts on, for a group's line. */
const NOUN: Record<ActionKind, string> = {
  delete: 'posts and replies',
  unretweet: 'reposts',
  unlike: 'posts',
  relike: 'posts',
  read: 'pages',
};

/** One line of the log as shown: an entry, or a run of the same confirmed action folded into one. */
export type LogRow =
  | { kind: 'entry'; entry: LogEntry }
  | { kind: 'group'; key: string; label: string; from: number; to: number; entries: LogEntry[] };

const dayOf = (ts: number) => new Date(ts).toDateString();

/** Whether two entries are the same confirmed action of one job on one day. */
const sameRun = (a: LogEntry, b: LogEntry) =>
  a.level === 'success' &&
  b.level === 'success' &&
  a.action !== 'system' &&
  a.action === b.action &&
  a.jobId === b.jobId &&
  a.message === b.message &&
  dayOf(a.ts) === dayOf(b.ts);

/**
 * The rows for `entries` in their order (newest first in the dashboard): runs of at least `MIN_GROUP` of the same
 * confirmed action within one job and one day become one group, labelled like "Deleted 31 posts and replies"; every
 * other entry stays a row of its own.
 */
export function groupLog(entries: readonly LogEntry[]): LogRow[] {
  const rows: LogRow[] = [];
  let run: LogEntry[] = [];
  const flush = () => {
    const [first] = run;
    if (first && run.length >= MIN_GROUP && first.action !== 'system') {
      const times = run.map((e) => e.ts);
      rows.push({
        kind: 'group',
        key: `${first.seq ?? first.ts}-${run.length}`,
        label: `${first.message} ${run.length.toLocaleString('en')} ${NOUN[first.action]}`,
        from: Math.min(...times),
        to: Math.max(...times),
        entries: run,
      });
    } else {
      for (const entry of run) rows.push({ kind: 'entry', entry });
    }
    run = [];
  };
  for (const entry of entries) {
    const last = run.at(-1);
    if (last && !sameRun(last, entry)) flush();
    run.push(entry);
  }
  flush();
  return rows;
}
