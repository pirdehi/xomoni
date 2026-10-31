import type { CleanupTarget, ItemKind, JobState, Outcome } from '../shared/types';
import type { Tone } from './components/ui';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

/** Formats a count for tiles and chart axes: exact below 10,000, compact above (`12.3K`). */
export const fmtCompact = (n: number) => (n < 10_000 ? full.format(n) : compact.format(n));
/** Formats a number with English thousands separators. */
export const fmtNumber = (n: number) => full.format(n);

/** Short English date in local time, such as `Mar 5, 2021`; `—` for null, undefined or 0. */
export function fmtDate(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Month, day and time in local time, without the year; `—` for null, undefined or 0. */
export function fmtDateTime(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Formats a duration given in ms with its two largest units (`2d 3h`, `5m 12s`); `0s` for zero or less. */
export function fmtDuration(ms: number) {
  if (ms <= 0) return '0s';
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Relative time for a past timestamp (`just now`, `5m ago`, `3h ago`); after 24 hours, the date. */
export function fmtAgo(ms: number, now = Date.now()) {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return fmtDate(ms);
}

/** Value for <input type="date"> in local time. */
export function toDateInput(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses an `<input type="date">` value (`YYYY-MM-DD`) as local midnight in ms; null when it is empty or incomplete. */
export function fromDateInput(value: string): number | null {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : null;
}

/** Capitalized plural label per item kind, for tabs and headings. */
export const KIND_PLURAL: Record<ItemKind, string> = {
  post: 'Posts',
  reply: 'Replies',
  repost: 'Reposts',
  like: 'Likes',
};
/** Lower-case plural per cleanup target, for use inside sentences and job titles. */
export const TARGET_PLURAL: Record<CleanupTarget, string> = {
  post: 'posts',
  reply: 'replies',
  repost: 'reposts',
  like: 'likes',
};

/** Badge label and tone per stored job state. `waiting` reads "Needs you"; `blocked` is a safety stop. */
export const JOB_STATE: Record<JobState, { label: string; tone: Tone }> = {
  queued: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  waiting: { label: 'Needs you', tone: 'serious' },
  paused: { label: 'Paused', tone: 'warn' },
  blocked: { label: 'Stopped for safety', tone: 'critical' },
  completed: { label: 'Completed', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'critical' },
};

/** Short human-readable label per action outcome. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
  done: 'Done',
  already: 'Already gone',
  not_found: 'Not found',
  skipped: 'Left alone',
  rate_limited: 'Rate limited',
  daily_limit: 'Daily limit',
  automation_flag: 'Flagged (226)',
  locked: 'Account locked',
  suspended: 'Account suspended',
  restricted: 'Refused by X',
  logged_out: 'Logged out',
  failed: 'Failed',
};

/** Link to a post on x.com. Without a handle it uses the `/i/web/status/<id>` form, which needs no author. */
export function postUrl(id: string, handle?: string) {
  return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

/** Saves `content` as a file named `name` through a temporary object URL; `type` is the MIME type (JSON by default). */
export function downloadFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
