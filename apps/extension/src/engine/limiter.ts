// Paces actions and keeps them inside every known limit, at one fifth of every limit X announces
// (ADR-0012): jittered delays, batch breaks, rolling hourly/daily caps, X's published limits and the live
// limits in its rate-limit headers, optional active hours, and an adaptive slowdown after soft errors.
import { db } from '../shared/db';
import { DAY, HOUR } from '../shared/time';
import type { ActionKind, Outcome, Settings } from '../shared/types';
import {
  ACTION_BUDGETS,
  BUDGETS,
  type BudgetId,
  WARMUP_RESET_DAYS,
  allowances,
  earlierActiveDays,
  liveSlot,
  nextSlot,
  scaleAllowances,
  scaleRule,
  spendsQuota,
  warmup,
} from '../shared/x-limits';
import { randomBetween, sleep } from './timers';

/** Reports a wait the limiter starts: `reason` for the status line, `until` in epoch ms. */
export type WaitNotifier = (reason: string, until: number) => void;

/** The budgets an action spends; reads spend the budget of the page being loaded. */
function budgetsOf(action: ActionKind, readBudget?: BudgetId): readonly BudgetId[] {
  if (action === 'read') return readBudget ? [readBudget] : [];
  return ACTION_BUDGETS[action];
}

/**
 * Paces one run's actions. Each run builds a new limiter, seeded from the activity log and the page loads of
 * the last 24 h (the `reads` table), so caps and budgets carry over between runs. Under the one-fifth rule
 * (ADR-0012) nothing here can go faster than one fifth of X's limits; the warm-up only goes slower.
 */
export class Limiter {
  private history = new Map<ActionKind, number[]>();
  private budgetUses = new Map<BudgetId, number[]>();
  private sinceBreak = new Map<ActionKind, number>();
  private penalty = 1;
  private step = warmup(0);

  constructor(
    private settings: Settings,
    private accountId: string,
    private signal: AbortSignal,
    private onWait: WaitNotifier,
  ) {}

  /**
   * Seeds the rolling windows: caps from the last 24 h of successful actions, X budgets from every request
   * that reached X (failed ones included), and the warm-up step from the days with actions in the last
   * two weeks.
   */
  async init() {
    const now = Date.now();
    const since = now - DAY;
    const [logs, reads] = await Promise.all([
      db.logs
        .where('[accountId+ts]')
        .between([this.accountId, now - WARMUP_RESET_DAYS * DAY], [this.accountId, Infinity])
        .toArray(),
      db.reads.where('[accountId+ts]').between([this.accountId, since], [this.accountId, Infinity]).toArray(),
    ]);
    const acted: number[] = [];
    for (const row of logs) {
      if (!row.outcome || row.action === 'system' || row.action === 'read' || !spendsQuota(row.outcome)) continue;
      acted.push(row.ts);
      if (row.ts < since) continue;
      if (row.outcome === 'done') this.stamps(row.action).push(row.ts);
      for (const id of budgetsOf(row.action)) this.uses(id).push(row.ts);
    }
    this.step = warmup(earlierActiveDays(acted, now));
    for (const row of reads) {
      this.stamps('read').push(row.ts);
      if (row.budget in BUDGETS) this.uses(row.budget as BudgetId).push(row.ts);
    }
    // Page loads older than a day no longer count anywhere.
    await db.reads.where('[accountId+ts]').between([this.accountId, -Infinity], [this.accountId, since]).delete();
  }

  /** The account's warm-up step: day 1–4 and the share of the one-fifth allowances it may use. */
  get warmup() {
    return this.step;
  }

  /** Current slowdown factor: 1 is normal, up to 6 after errors. */
  get slowdown() {
    return this.penalty;
  }

  /** Requests that spent budget `id` in the last 24 h, failed ones included. */
  spent(id: BudgetId) {
    const since = Date.now() - DAY;
    return this.uses(id).filter((t) => t > since).length;
  }

  /** Successful uses of `action` in the last hour and the last 24 h, including earlier runs. */
  usage(action: ActionKind) {
    const now = Date.now();
    const stamps = this.stamps(action);
    return { hour: stamps.filter((t) => t > now - HOUR).length, day: stamps.filter((t) => t > now - DAY).length };
  }

  private stamps(action: ActionKind) {
    let list = this.history.get(action);
    if (!list) this.history.set(action, (list = []));
    return list;
  }

  private uses(id: BudgetId) {
    let list = this.budgetUses.get(id);
    if (!list) this.budgetUses.set(id, (list = []));
    return list;
  }

  private async wait(until: number, reason: string) {
    if (until <= Date.now()) return;
    this.onWait(reason, until);
    await sleep(until - Date.now(), this.signal);
  }

  /**
   * Resolves when it is OK to perform `action`. For a page load or scroll, pass the read budget of the page
   * (`readBudgetFor(url)`), so one fifth of that page's own quota applies.
   */
  async before(action: ActionKind, readBudget?: BudgetId) {
    // During warm-up the caps shrink and the delays grow; never the other way.
    const rule = scaleRule(this.settings.pacing[action], this.step.factor);
    const warm = this.step.factor < 1 ? ` · warm-up day ${this.step.day} of ${this.step.days}` : '';
    const now = Date.now();
    const stamps = this.stamps(action);
    while (stamps.length && stamps[0] < now - DAY) stamps.shift();

    await this.waitForActiveHours();

    if (stamps.length >= rule.dailyCap) {
      await this.wait(
        stamps[stamps.length - rule.dailyCap] + DAY + randomBetween(60_000, 300_000),
        `Daily cap of ${rule.dailyCap} reached${warm}`,
      );
    }
    const lastHour = stamps.filter((t) => t > Date.now() - HOUR);
    if (lastHour.length >= rule.hourlyCap) {
      await this.wait(
        lastHour[lastHour.length - rule.hourlyCap] + HOUR + randomBetween(10_000, 60_000),
        `Hourly cap of ${rule.hourlyCap} reached${warm}`,
      );
    }

    for (const id of budgetsOf(action, readBudget)) {
      // One fifth of every window X publishes for this kind of request.
      const uses = this.uses(id);
      const allowed = scaleAllowances(allowances(id), this.step.factor);
      const slot = nextSlot(uses, allowed, Date.now());
      if (slot > Date.now()) {
        const i = allowed.findIndex((a) => uses.filter((t) => t > Date.now() - a.windowMs).length >= a.limit);
        const full = BUDGETS[id].published[i];
        const what = full
          ? ` (${allowed[i].limit} of X’s ${full.limit} per ${full.windowMs >= DAY ? 'day' : '15 min'}${warm})`
          : '';
        await this.wait(
          slot + randomBetween(5_000, 30_000),
          `${BUDGETS[id].label}: Xomoni’s share of X’s limit used${what}`,
        );
      }
      // One fifth of the live limit X reports for each operation that spends this budget.
      for (const op of BUDGETS[id].ops) {
        const live = await db.limits.get(`${this.accountId}:${op}`);
        const until = liveSlot(live, Date.now());
        if (until > Date.now()) {
          await this.wait(
            until + randomBetween(5_000, 20_000),
            `${BUDGETS[id].label}: one fifth of X’s live limit used — waiting for X’s window to reset`,
          );
        }
      }
    }

    const done = this.sinceBreak.get(action) ?? 0;
    if (done >= rule.batchSize) {
      this.sinceBreak.set(action, 0);
      await this.wait(
        Date.now() + randomBetween(rule.batchPauseMin, rule.batchPauseMax) * 1000,
        'Taking a short break between batches',
      );
    }

    const delay = randomBetween(rule.minDelay, rule.maxDelay) * 1000 * this.penalty;
    await this.wait(
      Date.now() + delay,
      this.penalty > 1.01 ? `Slowed down ×${this.penalty.toFixed(1)} after errors` : 'Pacing',
    );
  }

  /**
   * Records the result of an action. Every request that reached X spends X's budget, successful or not.
   * Soft failures slow everything down; only successful actions on X (deletes, unlikes, undone reposts) ease
   * the slowdown again, never page loads or scrolls.
   */
  after(action: ActionKind, outcome: Outcome, readBudget?: BudgetId) {
    const now = Date.now();
    if (spendsQuota(outcome)) for (const id of budgetsOf(action, readBudget)) this.uses(id).push(now);
    if (outcome === 'done') {
      this.stamps(action).push(now);
      this.sinceBreak.set(action, (this.sinceBreak.get(action) ?? 0) + 1);
      if (action === 'read') {
        void db.reads.add({ accountId: this.accountId, budget: readBudget ?? 'userTimeline', ts: now });
      } else {
        this.penalty = Math.max(1, this.penalty * 0.95);
      }
    } else if (outcome === 'rate_limited' || outcome === 'failed') {
      this.penalty = Math.min(6, this.penalty * 1.6);
    }
  }

  /** Waits until `until` (epoch ms), showing `reason`. Used for X's rate-limit resets and after X's checks. */
  async cooldown(until: number, reason: string) {
    await this.wait(until, reason);
  }

  /** After X checks the account, start again at a slower pace; it recovers with each successful action. */
  easeIn() {
    this.penalty = Math.max(this.penalty, 2);
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
