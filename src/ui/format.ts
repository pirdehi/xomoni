import type { CleanupTarget, ItemKind, JobState, Outcome } from '../shared/types';
import type { Tone } from './components/ui';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

export const fmtCompact = (n: number) => (n < 10_000 ? full.format(n) : compact.format(n));
export const fmtNumber = (n: number) => full.format(n);

export function fmtDate(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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

export function fromDateInput(value: string): number | null {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : null;
}

export const KIND_PLURAL: Record<ItemKind, string> = { post: 'Posts', reply: 'Replies', repost: 'Reposts', like: 'Likes' };
export const TARGET_PLURAL: Record<CleanupTarget, string> = { post: 'posts', reply: 'replies', repost: 'reposts', like: 'likes' };

export const JOB_STATE: Record<JobState, { label: string; tone: Tone }> = {
  queued: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  paused: { label: 'Paused', tone: 'warn' },
  blocked: { label: 'Stopped for safety', tone: 'critical' },
  completed: { label: 'Completed', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'critical' },
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  done: 'Done',
  already: 'Already gone',
  not_found: 'Not found',
  skipped: 'Left alone',
  rate_limited: 'Rate limited',
  daily_limit: 'Daily limit',
  automation_flag: 'Flagged (226)',
  locked: 'Account locked',
  logged_out: 'Logged out',
  failed: 'Failed',
};

export function postUrl(id: string, handle?: string) {
  return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
