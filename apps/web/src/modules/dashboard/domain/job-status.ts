import type { Device, JobSummary } from './model';

/** Visual weight of a status; the UI maps each tone to colors. */
export type Tone = 'neutral' | 'accent' | 'serious' | 'warn' | 'critical' | 'good';

/** Label and tone for each job state. Same wording as the extension (`apps/extension/src/ui/format.ts`). */
export const JOB_STATE: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  waiting: { label: 'Needs you', tone: 'serious' },
  paused: { label: 'Paused', tone: 'warn' },
  blocked: { label: 'Stopped for safety', tone: 'critical' },
  completed: { label: 'Completed', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'critical' },
};

/** Label and tone for a state, including states this website doesn't know yet. */
export function jobStateView(state: string): { label: string; tone: Tone } {
  return JOB_STATE[state] ?? { label: state, tone: 'neutral' };
}

/** Percent of matched items settled (done, skipped or failed), or `null` for scans and empty jobs. */
export function jobProgress(job: Pick<JobSummary, 'kind' | 'matched' | 'done' | 'skipped' | 'failed'>): number | null {
  const total = job.kind === 'scan' ? 0 : job.matched;
  if (total <= 0) return null;
  return Math.min(100, Math.round(((job.done + job.skipped + job.failed) / total) * 100));
}

/** A device counts as online if it reported within this window. */
export const ONLINE_WINDOW_MS = 3 * 60_000;

/** Whether the device reported recently enough to count as online. */
export function isOnline(device: Pick<Device, 'lastSeenAt'>, now: number): boolean {
  return now - Date.parse(device.lastSeenAt) < ONLINE_WINDOW_MS;
}

/** Inserts or replaces `row` by id and keeps the list newest first by `sortKey`. */
export function upsertNewestFirst<T extends { id: string }>(list: readonly T[], row: T, sortKey: keyof T): T[] {
  const next = [row, ...list.filter((item) => item.id !== row.id)];
  return next.sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey])));
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday"… relative to `now`. */
export function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}
