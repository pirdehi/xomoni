// How Xomoni spreads its work over time (PLAYBOOK B4, #30): work sessions with rests between them, and
// delays that vary around the middle of each rule's range with an occasional longer pause. The goal is a low
// hourly load spread over the day, not imitating a person. Everything here only slows Xomoni down (ADR-0012).
import type { PacingRule } from './types';

const MINUTE = 60_000;

/**
 * A work session lasts 25–50 minutes, then Xomoni rests 10–30 minutes. Any quiet gap of `breakMinMs` or more
 * between requests to X already counts as that rest.
 */
export const SESSION = {
  minMs: 25 * MINUTE,
  maxMs: 50 * MINUTE,
  breakMinMs: 10 * MINUTE,
  breakMaxMs: 30 * MINUTE,
} as const;

/** About one delay in twenty gets 30–90 extra seconds. */
export const LONG_PAUSE = { chance: 0.05, minSec: 30, maxSec: 90 } as const;

/** Spread of the log-normal delay around the middle of the range: most delays land near it, some near the ends. */
const SPREAD = 0.25;

/**
 * When the current work session started, from the times (epoch ms) of recent requests to X: the earliest
 * request of the latest stretch with no gap of `SESSION.breakMinMs` or more. With no request in the last
 * `breakMinMs`, a new session starts at `now`. Seeding from history means a new run can't skip a rest.
 */
export function sessionStart(stamps: readonly number[], now: number): number {
  const newestFirst = stamps.filter((t) => t <= now).sort((a, b) => b - a);
  if (!newestFirst.length || now - newestFirst[0] >= SESSION.breakMinMs) return now;
  let start = newestFirst[0];
  for (const t of newestFirst.slice(1)) {
    if (start - t >= SESSION.breakMinMs) break;
    start = t;
  }
  return start;
}

/**
 * Seconds to wait before the next action under `rule`: log-normal around the middle of [minDelay, maxDelay],
 * kept inside that range, plus a `LONG_PAUSE` about one time in twenty. Never below `minDelay`, and on average
 * longer than the uniform delay it replaced, because the log-normal leans toward `maxDelay`.
 * @param rule The action's pacing rule; only its delay range is used.
 * @param random A source of numbers in [0, 1); tests pass a fixed sequence.
 */
export function pacingDelay(
  rule: Pick<PacingRule, 'minDelay' | 'maxDelay'>,
  random: () => number = Math.random,
): number {
  const min = rule.minDelay;
  const max = Math.max(min, rule.maxDelay);
  // Box–Muller: a standard normal value from two uniform ones.
  const normal = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const delay = Math.min(max, Math.max(min, ((min + max) / 2) * Math.exp(SPREAD * normal)));
  const pause =
    random() < LONG_PAUSE.chance ? LONG_PAUSE.minSec + random() * (LONG_PAUSE.maxSec - LONG_PAUSE.minSec) : 0;
  return delay + pause;
}
