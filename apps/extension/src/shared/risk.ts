/**
 * The risk ladder (PLAYBOOK §7, B1, C1, C2): Xomoni backs off one step before X does.
 *
 * Every signal of trouble from X (error 226, an account lock, a refused write, a suspension, rate limits, an
 * action X confirmed but did not apply) is
 * stored as a dated event per account. The level, the pace and when a stopped job may resume are all derived
 * from those events here, so they survive restarts and can be tested without a browser. The ladder only ever
 * slows Xomoni down; it never raises the pace above one fifth of X's limits (ADR-0012, ADR-0013).
 */
import { DAY, HOUR } from './time';

/**
 * A signal from X that the account is under pressure, or the person's typed decision to resume anyway.
 * `silent_block`: a sampled action X confirmed was found not applied on its post page (PLAYBOOK C5).
 */
export type RiskEventKind =
  'automation_flag' | 'lock' | 'restricted' | 'suspended' | 'silent_block' | 'rate_limited' | 'override';

/** One stored risk event. */
export interface RiskEvent {
  /** Auto-increment key. */
  seq?: number;
  accountId: string;
  kind: RiskEventKind;
  /** Epoch ms. */
  at: number;
}

/** 0 Normal, 1 Caution, 2 Retreat, 3 Defensive, 4 Full stop. */
export type RiskLevel = 0 | 1 | 2 | 3 | 4;

/** Names of the levels, as the dashboard shows them. */
export const RISK_LABELS: Record<RiskLevel, string> = {
  0: 'Normal',
  1: 'Caution',
  2: 'Retreat',
  3: 'Defensive',
  4: 'Full stop',
};

/** What the ladder says about an account right now. */
export interface RiskAssessment {
  level: RiskLevel;
  /** Multiplier on Xomoni's one-fifth allowances and caps: 1, 0.5 or 0.25. Never above 1. */
  capFactor: number;
  /** When the reduced pace ends (epoch ms), or null at full pace. */
  reducedUntil: number | null;
  /** A stopped job may not resume before this (epoch ms), or null. */
  resumeAt: number | null;
  /** No automatic resume at all: only the person's typed decision (an `override` event) lifts it. */
  fullStop: boolean;
  /** Warm-up steps to drop: one per 226, lock, refusal or silent block in the last two weeks. */
  warmupDrop: number;
  /** Why the account is at this level, for the person; empty at level 0. */
  reason: string;
}

const WEEK = 7 * DAY;
/** Events that drop the warm-up back a step (PLAYBOOK B5). */
const WARMUP_DROPS = new Set<RiskEventKind>(['automation_flag', 'lock', 'restricted', 'silent_block']);
const MONTH = 30 * DAY;

/** How long a lock or refusal keeps the pace at a quarter, before it rises to half for the rest of the week. */
const DEFENSIVE_MS = 48 * HOUR;

/**
 * Evaluates the ladder for one account from its risk events at time `now`.
 *
 * - **Caution (1):** one rate limit in the last hour. The limiter already waits and slows down.
 * - **Retreat (2):** a first 226 (resume locked 6 h) or two rate limits within an hour (6 h). Half pace for
 *   7 days.
 * - **Defensive (3):** a second 226 within 7 days (resume locked 24 h), an account lock, or a refused write
 *   (resume locked 12 h). A quarter of the pace for 48 h, then half until the week is over.
 * - **Full stop (4):** a suspension or a silent block (30 days), a second lock or a third 226 within 7 days. No automatic
 *   resume; an `override` event (the person typed their decision) lifts the stop for earlier events, while the
 *   pace stays at a quarter for 48 h after it.
 */
export function assessRisk(events: readonly RiskEvent[], now: number): RiskAssessment {
  const sorted = [...events].filter((e) => e.at <= now).sort((a, b) => a.at - b.at);
  const lastOverride = sorted.filter((e) => e.kind === 'override').pop()?.at ?? -Infinity;
  const week = sorted.filter((e) => e.at > now - WEEK);
  const of = (kind: RiskEventKind, list: readonly RiskEvent[] = week) => list.filter((e) => e.kind === kind);
  // Resume locks and full stops come only from events after the person's last typed override; the pace
  // stays reduced for every event of the week either way.
  const afterOverride = (e: RiskEvent) => e.at > lastOverride;

  let factor = 1;
  let reducedUntil = 0;
  let resumeAt = 0;
  const slow = (f: number, until: number) => {
    if (until <= now) return;
    factor = Math.min(factor, f);
    reducedUntil = Math.max(reducedUntil, until);
  };
  const lockResume = (e: RiskEvent, until: number) => {
    if (afterOverride(e)) resumeAt = Math.max(resumeAt, until);
  };

  // Error 226 (X says the activity looks automated): the first in a week halves the pace and locks resume
  // for 6 h; any later one quarters it and locks resume for 24 h.
  of('automation_flag').forEach((e, i) => {
    slow(i === 0 ? 0.5 : 0.25, e.at + WEEK);
    lockResume(e, e.at + (i === 0 ? 6 : 24) * HOUR);
  });
  // Account locks and refused writes: a quarter of the pace for 48 h, then half until the week is over.
  for (const e of [...of('lock'), ...of('restricted')]) {
    slow(0.25, e.at + DEFENSIVE_MS);
    slow(0.5, e.at + WEEK);
    if (e.kind === 'restricted') lockResume(e, e.at + 12 * HOUR);
  }
  // Two rate limits within an hour: retreat.
  const limits = of('rate_limited');
  for (let i = 1; i < limits.length; i++) {
    if (limits[i].at - limits[i - 1].at > HOUR) continue;
    slow(0.5, limits[i].at + WEEK);
    lockResume(limits[i], limits[i].at + 6 * HOUR);
  }
  // After the person resumes anyway, a quarter of the pace for 48 h.
  if (lastOverride > now - DEFENSIVE_MS) slow(0.25, lastOverride + DEFENSIVE_MS);

  // Full stop.
  const recent = sorted.filter(afterOverride);
  const suspended = recent.some((e) => e.kind === 'suspended' && e.at > now - MONTH);
  const silent = recent.some((e) => e.kind === 'silent_block' && e.at > now - MONTH);
  const locks = of(
    'lock',
    recent.filter((e) => e.at > now - WEEK),
  ).length;
  const flags = of(
    'automation_flag',
    recent.filter((e) => e.at > now - WEEK),
  ).length;
  const fullStop = suspended || silent || locks >= 2 || flags >= 3;

  const reasons: string[] = [];
  if (suspended) reasons.push('X suspended this account');
  else if (silent) reasons.push('X confirmed an action but did not apply it, which points to a silent block');
  else if (locks >= 2) reasons.push('X locked this account twice within 7 days');
  else if (flags >= 3) reasons.push('X flagged the activity as automated (226) three times within 7 days');
  else {
    const flagCount = of('automation_flag').length;
    if (flagCount)
      reasons.push(`X flagged the activity as automated (226)${flagCount > 1 ? ` ${flagCount} times` : ''}`);
    if (of('lock').length) reasons.push('X locked this account');
    if (of('restricted').length) reasons.push('X refused an action, so the account may be limited');
    if (factor < 1 && !reasons.length) {
      reasons.push(
        lastOverride > now - DEFENSIVE_MS ? 'You chose to resume anyway' : 'X rate-limited Xomoni twice within an hour',
      );
    }
  }

  const recentLimit = limits.some((e) => e.at > now - HOUR);
  const level: RiskLevel = fullStop ? 4 : factor <= 0.25 ? 3 : factor < 1 ? 2 : recentLimit ? 1 : 0;
  if (level === 1) reasons.push('X rate-limited Xomoni in the last hour');

  const twoWeeks = sorted.filter((e) => e.at > now - 2 * WEEK);
  return {
    level,
    capFactor: factor,
    reducedUntil: reducedUntil > now ? reducedUntil : null,
    resumeAt: resumeAt > now ? resumeAt : null,
    fullStop,
    warmupDrop: twoWeeks.filter((e) => WARMUP_DROPS.has(e.kind)).length,
    reason: reasons.join('; '),
  };
}

/**
 * Whether a new event of `kind` repeats one already recorded: the same kind within 10 minutes. Waiting for the
 * person can report the same lock several times; it counts once.
 */
export function isDuplicateRisk(events: readonly RiskEvent[], kind: RiskEventKind, now: number): boolean {
  return kind !== 'override' && events.some((e) => e.kind === kind && now - e.at < 10 * 60_000 && e.at <= now);
}
