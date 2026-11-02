// The activity log as files a person can audit (#34): what Xomoni did, skipped or stopped for, post by post.
// Built in the dashboard and saved on the person's own computer; nothing is uploaded (ADR-0004).
import type { Account, LogEntry } from './types';

/** The columns of the CSV export, in order. */
export const ACTIVITY_COLUMNS = [
  'time',
  'level',
  'action',
  'outcome',
  'post_id',
  'post_url',
  'job_id',
  'message',
] as const;

/** Version of the JSON format; raise it when a field changes meaning. */
export const ACTIVITY_FORMAT_VERSION = 1;

/** The post on x.com an entry is about, or null for job events. */
export function entryUrl(entry: Pick<LogEntry, 'targetId'>): string | null {
  return entry.targetId ? `https://x.com/i/web/status/${entry.targetId}` : null;
}

/**
 * One CSV field (RFC 4180): quoted when it holds a quote, a comma or a line break (`\r` included, which
 * spreadsheets also read as one), with quotes doubled.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The entries as CSV with a header row, oldest first, one line per entry. */
export function activityCsv(entries: readonly LogEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.ts - b.ts)
    .map((e) =>
      [new Date(e.ts).toISOString(), e.level, e.action, e.outcome, e.targetId, entryUrl(e), e.jobId, e.message]
        .map(csvCell)
        .join(','),
    );
  return [ACTIVITY_COLUMNS.join(','), ...rows].join('\n');
}

/** The entries as JSON for tools: the account, when it was exported, and every entry oldest first. */
export function activityJson(
  account: Pick<Account, 'id' | 'handle'>,
  entries: readonly LogEntry[],
  exportedAt = Date.now(),
): string {
  return JSON.stringify(
    {
      format: 'xomoni-activity',
      version: ACTIVITY_FORMAT_VERSION,
      account: { id: account.id, handle: account.handle },
      exportedAt: new Date(exportedAt).toISOString(),
      entries: [...entries]
        .sort((a, b) => a.ts - b.ts)
        .map((e) => ({
          time: new Date(e.ts).toISOString(),
          level: e.level,
          action: e.action,
          outcome: e.outcome,
          postId: e.targetId,
          postUrl: entryUrl(e),
          jobId: e.jobId,
          message: e.message,
        })),
    },
    null,
    2,
  );
}
