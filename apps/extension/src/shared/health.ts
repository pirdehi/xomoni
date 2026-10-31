/**
 * The account health report after a run (#25): what X signalled during the run, what the sample checks
 * found, what X's page showed at the end and the risk level, with a suggested rest. Pure: the engine gathers
 * the inputs (`JobContext.health`) and the job card and the notification show the result.
 */
import { RISK_LABELS, type RiskAssessment, type RiskEvent, type RiskEventKind, type RiskLevel } from './risk';
import { HOUR } from './time';

/** A signal from X; the person's own `override` is not one. */
export type HealthSignal = Exclude<RiskEventKind, 'override'>;

/** What the sample checks (PLAYBOOK C5) found during the run, and how many still wait for a later run. */
export interface SampleTally {
  applied: number;
  notApplied: number;
  unclear: number;
  pending: number;
}

/** The health report stored on a job (`Job.health`) at the end of each run. */
export interface JobHealth {
  /** When the run ended (epoch ms). */
  at: number;
  /** The risk ladder's level after the run. */
  level: RiskLevel;
  /** Signals from X during the run, by kind. */
  signals: Partial<Record<HealthSignal, number>>;
  checks: SampleTally;
  /** A restriction or lock notice X's page showed at the end of the run, or null. */
  notice: string | null;
  /** Suggested rest before the next run, in whole hours; 0 when none is needed. */
  restHours: number;
  /** A sentence or two for the job card and the notification. */
  summary: string;
}

/** The least rest to suggest after a run that ended on each level, in hours. */
const REST_HOURS: Record<RiskLevel, number> = { 0: 0, 1: 1, 2: 6, 3: 24, 4: 72 };

/** Singular and plural names of each signal, in the order the summary lists them. */
const SIGNAL_NAMES: [HealthSignal, string, string][] = [
  ['suspended', 'suspension', 'suspensions'],
  ['silent_block', 'silent block', 'silent blocks'],
  ['lock', 'account lock', 'account locks'],
  ['restricted', 'refused action', 'refused actions'],
  ['automation_flag', '226 warning', '226 warnings'],
  ['rate_limited', 'rate limit', 'rate limits'],
];

const count = (n: number, one: string, many: string) => `${n === 1 ? 'one' : n} ${n === 1 ? one : many}`;
const list = (parts: string[]) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/**
 * Builds the report from the ladder's view after the run (`risk`), the risk events recorded during it, the
 * sample-check tally and X's notice at the end, if any. A notice suggests at least a day of rest; a resume
 * lock at least until it ends.
 */
export function healthReport(input: {
  risk: RiskAssessment;
  events: readonly RiskEvent[];
  checks: SampleTally;
  notice: string | null;
  now: number;
}): JobHealth {
  const { risk, events, checks, notice, now } = input;
  const signals: JobHealth['signals'] = {};
  for (const e of events) if (e.kind !== 'override') signals[e.kind] = (signals[e.kind] ?? 0) + 1;

  const untilResume = risk.resumeAt ? Math.ceil((risk.resumeAt - now) / HOUR) : 0;
  const restHours = Math.max(REST_HOURS[risk.level], untilResume, notice ? 24 : 0);

  const parts: string[] = [];
  const seen = SIGNAL_NAMES.filter(([kind]) => signals[kind]).map(([kind, one, many]) =>
    count(signals[kind]!, one, many),
  );
  if (risk.level === 0 && !seen.length && !notice) parts.push('Healthy: no warnings from X.');
  else if (risk.level > 0) parts.push(`Risk level ${risk.level} (${RISK_LABELS[risk.level]}): ${risk.reason}.`);
  if (seen.length) parts.push(`During this run X sent ${list(seen)}.`);
  if (notice) parts.push(`X shows: “${notice}”.`);

  const ran = checks.applied + checks.notApplied + checks.unclear;
  if (ran || checks.pending) {
    const found = [
      checks.applied ? `${checks.applied} confirmed` : '',
      checks.notApplied ? `${checks.notApplied} not applied by X` : '',
      checks.unclear ? `${checks.unclear} unclear` : '',
      checks.pending ? `${checks.pending} still to run` : '',
    ].filter(Boolean);
    parts.push(`Sample checks: ${list(found)}.`);
  }

  if (risk.fullStop) parts.push('Check the account on X before deciding to resume.');
  else if (restHours > 0) parts.push(`Rest at least ${restHours} h before the next run.`);

  return { at: now, level: risk.level, signals, checks, notice, restHours, summary: parts.join(' ') };
}
