// Paces actions like a person would and keeps them inside every known limit:
// jittered delays, batch breaks, rolling hourly/daily caps, X's own rate-limit
// headers, optional active hours, and an adaptive slowdown after soft errors.
import { db } from '../shared/db';
import { DAY, HOUR } from '../shared/time';
import type { ActionKind, Outcome, Settings } from '../shared/types';
import { randomBetween, sleep } from './timers';

/** The X operation whose rate-limit headers govern each action. */
const GOVERNING_OP: Partial<Record<ActionKind, string>> = {
  delete: 'DeleteTweet',
  unretweet: 'DeleteRetweet',
  unlike: 'UnfavoriteTweet',
  relike: 'FavoriteTweet',
};

const READ_OPS = ['SearchTimeline', 'UserTweets', 'UserTweetsAndReplies', 'Likes', 'TweetDetail'];

export type WaitNotifier = (reason: string, until: number) => void;

export class Limiter {
  private history = new Map<ActionKind, number[]>();
  private sinceBreak = new Map<ActionKind, number>();
  private penalty = 1;

  constructor(
    private settings: Settings,
    private accountId: string,
    private signal: AbortSignal,
    private onWait: WaitNotifier,
  ) {}

  /** Seeds the rolling windows from the last 24h of successful actions. */
  async init() {
    const since = Date.now() - DAY;
    const rows = await db.logs.where('[accountId+ts]').between([this.accountId, since], [this.accountId, Infinity]).toArray();
    for (const row of rows) {
      if (row.outcome !== 'done' || row.action === 'system') continue;
      this.stamps(row.action).push(row.ts);
    }
  }

  get slowdown() {
    return this.penalty;
  }

  private stamps(action: ActionKind) {
    let list = this.history.get(action);
    if (!list) this.history.set(action, (list = []));
    return list;
  }

  private async wait(until: number, reason: string) {
    if (until <= Date.now()) return;
    this.onWait(reason, until);
    await sleep(until - Date.now(), this.signal);
  }

  /** Resolves when it is OK to perform `action`. */
  async before(action: ActionKind) {
    const raw = this.settings.pacing[action];
    const rule = { ...raw, dailyCap: Math.max(1, raw.dailyCap), hourlyCap: Math.max(1, raw.hourlyCap), batchSize: Math.max(1, raw.batchSize) };
    const now = Date.now();
    const stamps = this.stamps(action);
    while (stamps.length && stamps[0] < now - DAY) stamps.shift();

    await this.waitForActiveHours();

    if (stamps.length >= rule.dailyCap) {
      await this.wait(stamps[stamps.length - rule.dailyCap] + DAY + randomBetween(60_000, 300_000), `Daily cap of ${rule.dailyCap} reached`);
    }
    const lastHour = stamps.filter((t) => t > Date.now() - HOUR);
    if (lastHour.length >= rule.hourlyCap) {
      await this.wait(lastHour[lastHour.length - rule.hourlyCap] + HOUR + randomBetween(10_000, 60_000), `Hourly cap of ${rule.hourlyCap} reached`);
    }

    // Page loads and scrolls page through X's timelines; wait if any of them is exhausted.
    const ops = action === 'read' ? READ_OPS : GOVERNING_OP[action] ? [GOVERNING_OP[action]!] : [];
    for (const op of ops) {
      const obs = await db.limits.get(`${this.accountId}:${op}`);
      if (obs?.reset && obs.reset > Date.now() && (obs.status === 429 || (obs.remaining != null && obs.remaining <= 1))) {
        await this.wait(obs.reset + randomBetween(5_000, 20_000), `X rate limit for ${op} — waiting for the window to reset`);
      }
    }

    const done = this.sinceBreak.get(action) ?? 0;
    if (done >= rule.batchSize) {
      this.sinceBreak.set(action, 0);
      await this.wait(Date.now() + randomBetween(rule.batchPauseMin, rule.batchPauseMax) * 1000, 'Taking a short break between batches');
    }

    const delay = randomBetween(rule.minDelay, rule.maxDelay) * 1000 * this.penalty;
    await this.wait(Date.now() + delay, this.penalty > 1.01 ? `Slowed down ×${this.penalty.toFixed(1)} after errors` : 'Pacing');
  }

  /** Records the result of an action; soft failures slow everything down. */
  after(action: ActionKind, outcome: Outcome) {
    if (outcome === 'done') {
      this.stamps(action).push(Date.now());
      this.sinceBreak.set(action, (this.sinceBreak.get(action) ?? 0) + 1);
      this.penalty = Math.max(1, this.penalty * 0.95);
    } else if (outcome === 'rate_limited' || outcome === 'failed') {
      this.penalty = Math.min(6, this.penalty * 1.6);
    }
  }

  async cooldown(until: number, reason: string) {
    await this.wait(until, reason);
  }

  usage(action: ActionKind) {
    const now = Date.now();
    const stamps = this.stamps(action);
    return { hour: stamps.filter((t) => t > now - HOUR).length, day: stamps.filter((t) => t > now - DAY).length };
  }

  private async waitForActiveHours() {
    const { enabled, start, end } = this.settings.activeHours;
    if (!enabled || start === end) return;
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const inside = start < end ? hour >= start && hour < end : hour >= start || hour < end;
    if (inside) return;
    const next = new Date(now);
    next.setHours(start, Math.floor(randomBetween(0, 15)), 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    await this.wait(next.getTime(), `Outside active hours (${start}:00–${end}:00)`);
  }
}
