/** A browser where the Xomoni extension is signed in with this account. */
export interface Device {
  /** Row id. */
  id: string;
  /** Name the extension reported, such as "Chrome on macOS". */
  name: string;
  /** Extension version on that browser. */
  extensionVersion: string;
  /** Last time the extension reported in (ISO 8601). */
  lastSeenAt: string;
}

/** Job states, mirroring the extension's job lifecycle. */
export type JobState = 'queued' | 'running' | 'waiting' | 'paused' | 'blocked' | 'completed' | 'cancelled' | 'failed';

/** A level of the extension's risk ladder (ADR-0013), from 0 (Normal) to 4 (Full stop). */
export type RiskLevel = 0 | 1 | 2 | 3 | 4;

/** The status summary of one extension job. Counters and state only; post content never leaves the extension. */
export interface JobSummary {
  /** Row id. */
  id: string;
  /** The device running the job. */
  deviceId: string;
  /** The X account the job works on, without the @. */
  xHandle: string;
  /** A cleanup deletes; a scan only counts. */
  kind: 'cleanup' | 'scan';
  /** Human title, such as "Delete posts before Jan 1, 2024". */
  title: string;
  /** Lifecycle state; unknown values from newer extensions are kept as strings. */
  state: JobState | (string & {});
  /** What the job is doing right now. */
  phase: string;
  /** Why it is waiting or stopped, if it is. */
  stateReason: string;
  /** Items that matched the job's filter. */
  matched: number;
  /** Items deleted or unliked. */
  done: number;
  /** Items skipped by safety rules. */
  skipped: number;
  /** Items that failed. */
  failed: number;
  /** Items a scan has counted. */
  scanned: number;
  /** The X account's risk level when the job last reported, or null if the extension didn't report one. */
  riskLevel: RiskLevel | null;
  /** Last change (ISO 8601). */
  updatedAt: string;
}

/** How many jobs the dashboard shows, newest first. */
export const RECENT_JOBS_LIMIT = 50;

/** Everything the dashboard needs for its first paint. */
export interface DashboardSnapshot {
  /** Connected browsers. */
  devices: Device[];
  /** Recent jobs across those browsers. */
  jobs: JobSummary[];
}
