// Shared state and safety policy for one job run.
import { addLog, db, getSettings } from '../shared/db';
import type { ActionResult, PageInfo } from '../shared/messages';
import { DAY } from '../shared/time';
import type { ActionKind, Item, Job, JobState, LogLevel, Outcome, Settings } from '../shared/types';
import { Limiter } from './limiter';
import { Aborted, randomBetween } from './timers';
import { workerTab } from './worker-tab';

/** Thrown to end a run; `state` is what the job becomes. */
export class Stop extends Error {
  constructor(
    public state: Extract<JobState, 'paused' | 'blocked' | 'failed' | 'cancelled'>,
    message: string,
  ) {
    super(message);
  }
}

export interface RunnerHooks {
  status(message: string, waitUntil?: number | null): void;
}

export class JobContext {
  settings!: Settings;
  limiter!: Limiter;
  handle = '';
  /** Ids already handled in this run (acted on, kept, or skipped). */
  attempted = new Set<string>();
  private consecutiveFailures = 0;

  constructor(
    public job: Job,
    public signal: AbortSignal,
    private hooks: RunnerHooks,
  ) {}

  async init() {
    this.settings = await getSettings();
    this.limiter = new Limiter(this.settings, this.job.accountId, this.signal, (reason, until) => this.hooks.status(reason, until));
    await this.limiter.init();
  }

  checkpoint() {
    if (this.signal.aborted) throw new Aborted();
  }

  status(message: string) {
    this.hooks.status(message, null);
  }

  async setPhase(phase: string) {
    this.job.phase = phase;
    await this.save();
  }

  async save() {
    this.job.updatedAt = Date.now();
    await db.jobs.put(this.job);
  }

  log(level: LogLevel, action: ActionKind | 'system', message: string, targetId: string | null = null, outcome: Outcome | null = null) {
    return addLog({ accountId: this.job.accountId, jobId: this.job.id, level, action, targetId, outcome, message });
  }

  /** Opens the worker if needed and verifies it is signed in to the right account. */
  async connect(): Promise<PageInfo> {
    this.status('Connecting to the X worker window…');
    if ((await workerTab.current()) == null) await workerTab.open();
    const info = await workerTab.waitReady(this.signal);
    this.assertPage(info);
    if (info.viewerId !== this.job.accountId) {
      throw new Stop('blocked', 'The X worker window is signed in to a different account than this job.');
    }
    const account = await db.accounts.get(this.job.accountId);
    this.handle = info.handle || account?.handle || '';
    if (!this.handle) throw new Stop('blocked', 'Could not determine your @handle from X. Open your profile once in the worker window.');
    return info;
  }

  assertPage(info: PageInfo) {
    if (info.locked) throw new Stop('blocked', 'X locked the account and wants you to verify it. Open the worker window, complete X’s check yourself, then resume.');
    if (!info.loggedIn) throw new Stop('blocked', 'You are not logged in to X in the worker window. Log in there, then resume.');
    // X's session cookie is shared by every x.com tab, so switching accounts anywhere switches the worker too.
    if (info.viewerId && info.viewerId !== this.job.accountId) {
      throw new Stop('blocked', 'X is now signed in to a different account than this job. Switch back to the right account, then resume.');
    }
  }

  /** Re-checks lock / login / account right before an action. */
  async verifyPage() {
    const info = await workerTab.ping();
    if (info) this.assertPage(info);
  }

  /** Leaves an item untouched without counting it as a failure. */
  async leaveAlone(item: Pick<Item, 'id'>, message: string) {
    this.attempted.add(item.id);
    await this.log('info', 'system', `Left alone: ${message}`, item.id, 'skipped');
  }

  /** Paced navigation, counted against the page-load budget. */
  async navigate(url: string) {
    this.checkpoint();
    await this.limiter.before('read');
    this.status(`Opening ${url.replace('https://x.com', '')}`);
    const info = await workerTab.navigate(url, this.signal);
    this.limiter.after('read', 'done');
    this.assertPage(info);
    return workerTab.send({ cmd: 'waitContent', timeoutMs: 20_000 });
  }

  async scroll() {
    this.checkpoint();
    await this.limiter.before('read');
    const result = await workerTab.send({ cmd: 'scroll' });
    this.limiter.after('read', 'done');
    return result;
  }

  /**
   * Applies the safety policy to an action result. Returns true when the item is
   * settled (done / kept / gone) and false when it should be retried.
   */
  async settle(action: ActionKind, item: Pick<Item, 'key' | 'id'> | null, result: ActionResult): Promise<boolean> {
    const { outcome } = result;
    this.limiter.after(action, outcome);
    const target = item?.id ?? null;
    const detail = result.message ? ` — ${result.message}` : '';
    // Only settled items are excluded from the rest of this job; retries keep them eligible.
    const markTried = (patch: Partial<Item> = {}) => (item ? db.items.update(item.key, { lastJobId: this.job.id, ...patch }) : Promise.resolve(0));

    switch (outcome) {
      case 'done':
        this.consecutiveFailures = 0;
        this.job.stats.done++;
        await markTried({ status: 'deleted', statusAt: Date.now() });
        await this.log('success', action, VERB[action], target, outcome);
        await this.save();
        return true;

      case 'not_found':
      case 'already':
        this.consecutiveFailures = 0;
        this.job.stats.skipped++;
        // An "already" unlike is a ghost like: still in X's history, just not shown.
        await markTried(outcome === 'not_found' || action !== 'unlike' ? { status: 'gone', statusAt: Date.now() } : {});
        await this.log('info', action, `Skipped${detail}`, target, outcome);
        await this.save();
        return true;

      case 'rate_limited': {
        const until = result.resetAt && result.resetAt > Date.now() ? result.resetAt + randomBetween(10_000, 30_000) : Date.now() + randomBetween(15, 20) * 60_000;
        await this.log('warn', action, `X rate limit hit; resuming at ${new Date(until).toLocaleTimeString()}`, target, outcome);
        await this.limiter.cooldown(until, 'X rate limit — waiting for the window to reset');
        return false;
      }

      case 'daily_limit': {
        const until = Date.now() + DAY + randomBetween(5, 30) * 60_000;
        await this.log('warn', action, 'X daily limit reached; waiting ~24h', target, outcome);
        await this.limiter.cooldown(until, 'X daily limit — waiting about 24 hours');
        return false;
      }

      case 'automation_flag':
        await this.log('error', action, `X flagged this activity as automated${detail}`, target, outcome);
        throw new Stop(
          'blocked',
          'X flagged the activity as automated (error 226). Stop for several hours, use X normally, then resume with the Careful preset.',
        );

      case 'locked':
        await this.log('error', action, `Account locked${detail}`, target, outcome);
        throw new Stop('blocked', 'X locked the account. Open X, complete its check yourself, then resume.');

      case 'logged_out':
        await this.log('error', action, `Logged out${detail}`, target, outcome);
        throw new Stop('blocked', 'You were logged out of X in the worker window. Log in, then resume.');

      default: {
        this.consecutiveFailures++;
        this.job.stats.failed++;
        await markTried();
        await this.log('error', action, `Failed${detail}`, target, outcome);
        await this.save();
        if (this.consecutiveFailures >= this.settings.maxConsecutiveFailures) {
          throw new Stop(
            'paused',
            `${this.consecutiveFailures} failures in a row. X may have changed its page, or the worker window is not visible. Check it, then resume.`,
          );
        }
        return true;
      }
    }
  }
}

const VERB: Record<ActionKind, string> = {
  delete: 'Deleted',
  unretweet: 'Undid repost',
  unlike: 'Unliked',
  relike: 'Removed ghost like',
  read: 'Loaded page',
};
