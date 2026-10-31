import type { Tone } from './job-status';
import type { JobSummary, RiskLevel } from './model';

/**
 * Name, tone and plain meaning of each risk level. The names are the extension's
 * (`apps/extension/src/shared/risk.ts`, ADR-0013); a unit test fails if they drift apart.
 */
export const RISK_LEVEL: Record<RiskLevel, { label: string; tone: Tone; meaning: string }> = {
  0: { label: 'Normal', tone: 'good', meaning: 'No recent warnings from X.' },
  1: {
    label: 'Caution',
    tone: 'warn',
    meaning: 'X rate-limited Xomoni in the last hour. The pace stays the same; another limit slows it down.',
  },
  2: {
    label: 'Retreat',
    tone: 'warn',
    meaning: 'X pushed back. Xomoni works at half its pace and may wait a few hours before it continues.',
  },
  3: {
    label: 'Defensive',
    tone: 'critical',
    meaning: 'X pushed back again or limited the account. Xomoni works at a quarter of its pace.',
  },
  4: {
    label: 'Full stop',
    tone: 'critical',
    meaning: 'Xomoni stopped work on this account. Check the account on X before deciding in the extension.',
  },
};

/** A risk level as stored, or null when it is missing or not a level this website knows. */
export function toRiskLevel(value: number | null | undefined): RiskLevel | null {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

/** One X account's risk level on one browser. */
export interface AccountRisk {
  /** The X account, without the @. */
  xHandle: string;
  /** The browser whose extension reported it; each browser keeps its own ladder. */
  deviceId: string;
  level: RiskLevel;
  /** When the job carrying this level last reported (ISO 8601). */
  reportedAt: string;
}

/**
 * The risk level of each X account on each browser, worst first. Each pair takes the level from its most
 * recently updated job; jobs that reported no level are ignored, so an account shows up only once its
 * level is known. Handles compare case-insensitively, as on X.
 */
export function accountRisks(jobs: readonly JobSummary[]): AccountRisk[] {
  const latest = new Map<string, AccountRisk>();
  for (const job of jobs) {
    if (job.riskLevel === null) continue;
    const key = `${job.deviceId}\n${job.xHandle.toLowerCase()}`;
    const seen = latest.get(key);
    if (seen && Date.parse(seen.reportedAt) >= Date.parse(job.updatedAt)) continue;
    latest.set(key, { xHandle: job.xHandle, deviceId: job.deviceId, level: job.riskLevel, reportedAt: job.updatedAt });
  }
  return [...latest.values()].sort(
    (a, b) => b.level - a.level || a.xHandle.localeCompare(b.xHandle) || b.reportedAt.localeCompare(a.reportedAt),
  );
}

/**
 * Jobs that wait for the person (`waiting`, shown as "Needs you"): logging in to X, one of X's checks, or
 * switching back to the right account. Only the person can do these, in the extension's window.
 */
export function jobsNeedingYou(jobs: readonly JobSummary[]): JobSummary[] {
  return jobs.filter((job) => job.state === 'waiting');
}
