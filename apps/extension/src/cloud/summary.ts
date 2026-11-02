// What one job's status looks like on the website (ADR-0004, ADR-0018): Xomoni's own title, state, phase and
// counters, the timestamps and the account's risk level. Never post text, never X's notices.
import type { Job } from '../shared/types';

/** One job as `device_report` stores it. Field names follow the `jobs` table. */
export interface JobReport {
  local_id: string;
  x_handle: string;
  kind: Job['kind'];
  title: string;
  state: Job['state'];
  phase: string;
  /** Always empty: a job's reason can quote X's notices, which never leave the browser. */
  state_reason: '';
  matched: number;
  done: number;
  skipped: number;
  failed: number;
  scanned: number;
  risk_level: number | null;
  started_at: string | null;
  finished_at: string | null;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

/**
 * The report for `job` of the X account `handle` at risk level `riskLevel` (0–4), or null when the handle isn't
 * one X allows (the account was never seen with its handle), since the website groups jobs by handle.
 */
export function jobReport(job: Job, handle: string, riskLevel: number | null): JobReport | null {
  if (!HANDLE.test(handle)) return null;
  const { matched, done, skipped, failed, scanned } = job.stats;
  return {
    local_id: job.id,
    x_handle: handle,
    kind: job.kind,
    title: job.title.slice(0, 200) || 'Job',
    state: job.state,
    phase: job.phase.slice(0, 200),
    state_reason: '',
    matched,
    done,
    skipped,
    failed,
    scanned,
    risk_level: riskLevel,
    started_at: iso(job.startedAt),
    finished_at: iso(job.finishedAt),
  };
}
