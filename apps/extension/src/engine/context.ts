// Shared state and safety policy for one job run.
import { type Need, needMessage, pageNeed } from '../shared/attention';
import { addLog, db, getSettings } from '../shared/db';
import type { ActionResult, PageInfo } from '../shared/messages';
import { DAY, HOUR } from '../shared/time';
import type { ActionKind, Item, Job, JobState, LogLevel, Outcome, Settings } from '../shared/types';
import { type BudgetId, readBudgetFor } from '../shared/x-limits';
import { Limiter } from './limiter';
import { Aborted, randomBetween, sleep } from './timers';
import { NotReady, WorkerGone, workerTab } from './worker-tab';

/** How long a job waits for the person before pausing. */
const WAIT_FOR_YOU_MS = HOUR;
/** The page must look right this long before continuing (X redirects mid-login). */
const SETTLED_MS = 5000;
/** The same check this many times with no progress in between means waiting won't help. */
const MAX_REPEAT_NEEDS = 3;

/** Thrown to end a run; `state` is what the job becomes. */
export class Stop extends Error {
  constructor(
    public state: Extract<JobState, 'paused' | 'blocked' | 'failed' | 'cancelled'>,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when only the person can continue: the runner waits for them, then restarts the job's steps. */
export class NeedsYou extends Error {
  constructor(
    public need: Need,
    message: string,
    /** Raised from X's answer to an action, so the page may not show X's prompt yet. */
    public fromAction = false,
  ) {
    super(message);
  }
}

/** Callbacks from a running job to the runner, which shows them in the dashboard. */
export interface RunnerHooks {
  /** A progress line; `waitUntil` (epoch ms) is set while the limiter waits. */
  status(message: string, waitUntil?: number | null): void;
  /** Called with what X needs from the person, and with null once it's done. */
  attention(need: NeedsYou | null): void;
}

/**
 * State and safety policy for one run of a job: settings, the limiter, page checks and the handling of each
 * action's outcome (`settle`). The runner builds one per start or resume.
 */
export class JobContext {
  /** Settings read when the run started (`init`); changes apply from the next run. */
  settings!: Settings;
  limiter!: Limiter;
  /** The account's handle without `@`, used in URLs and search queries; set by `connect`. */
  handle = '';
  /** Ids already handled in this run (acted on, kept, or skipped). */
  attempted = new Set<string>();
  /** Read budget of the page the worker tab shows; scrolls spend it too. */
  private readBudget: BudgetId = 'userTimeline';
  private consecutiveFailures = 0;
  private repeatNeeds = 0;
  private progressAtLastNeed = -1;

  constructor(
    public job: Job,
    public signal: AbortSignal,
    private hooks: RunnerHooks,
  ) {}

  /** Loads settings and seeds the limiter. Call before anything else. */
  async init() {
    this.settings = await getSettings();
    this.limiter = new Limiter(this.settings, this.job.accountId, this.signal, (reason, until) =>
      this.hooks.status(reason, until),
    );
    await this.limiter.init();
  }

  /** Throws `Aborted` if the person paused or cancelled. */
  checkpoint() {
    if (this.signal.aborted) throw new Aborted();
  }

  status(message: string) {
    this.hooks.status(message, null);
  }

  /** Saves the resume marker (`Job.phase`). */
  async setPhase(phase: string) {
    this.job.phase = phase;
    await this.save();
  }

  /** Writes the job to IndexedDB with a fresh `updatedAt`. */
  async save() {
    this.job.updatedAt = Date.now();
    await db.jobs.put(this.job);
  }

  /** Adds an activity log entry for this job. */
  log(
    level: LogLevel,
    action: ActionKind | 'system',
    message: string,
    targetId: string | null = null,
    outcome: Outcome | null = null,
  ) {
    return addLog({ accountId: this.job.accountId, jobId: this.job.id, level, action, targetId, outcome, message });
  }

  /** Opens the worker if needed and verifies it is signed in to the right account. */
  async connect(): Promise<PageInfo> {
    this.status('Connecting to the X worker window…');
    if ((await workerTab.current()) == null) await workerTab.open();
    const info = await workerTab.waitReady(this.signal);
    const account = await db.accounts.get(this.job.accountId);
    this.handle ||= account?.handle ?? '';
    this.assertPage(info);
    this.handle = info.handle || this.handle;
    if (!this.handle)
      throw new Stop(
        'blocked',
        'Could not determine your @handle from X. Open your profile once in the worker window.',
      );
    return info;
  }

  /** Login, X checks and account switches all need the person, not a retry. */
  assertPage(info: PageInfo) {
    // X's session cookie is shared by every x.com tab, so switching accounts anywhere switches the worker too.
    const need = pageNeed(info, this.job.accountId);
    if (need) throw new NeedsYou(need, needMessage(need, this.handle));
  }

  /**
   * Waits — without acting — until the person has done what X asked for in the
   * worker window. Pauses the job if that takes longer than an hour.
   */
  async waitForYou(request: NeedsYou) {
    const { stats } = this.job;
    const progress = stats.done + stats.skipped + stats.failed + stats.scanned;
    this.repeatNeeds = progress === this.progressAtLastNeed ? this.repeatNeeds + 1 : 1;
    this.progressAtLastNeed = progress;
    if (this.repeatNeeds > MAX_REPEAT_NEEDS) {
      throw new Stop(
        'blocked',
        `X keeps asking for the same thing: ${request.message} Check the Xomoni window, then resume.`,
      );
    }

    this.job.state = 'waiting';
    this.job.stateReason = request.message;
    await this.save();
    await this.log('warn', 'system', `Waiting for you: ${request.message}`);
    this.hooks.attention(request);

    // An error code alone doesn't put X's prompt on screen; a fresh load does.
    if (request.fromAction) await workerTab.navigate('https://x.com/home', this.signal).catch(rethrowIfStopped);

    const deadline = Date.now() + WAIT_FOR_YOU_MS;
    let settledSince = 0;
    while (!settledSince || Date.now() - settledSince < SETTLED_MS) {
      if (Date.now() > deadline) {
        throw new Stop('paused', `Waited an hour for you. ${request.message} Then resume the job.`);
      }
      await sleep(1500, this.signal);
      const info = await workerTab.ping();
      settledSince = info && !pageNeed(info, this.job.accountId) ? settledSince || Date.now() : 0;
    }

    this.job.state = 'running';
    this.job.stateReason = '';
    await this.save();
    await this.log('success', 'system', 'X is ready again — continuing');
    this.hooks.attention(null);
    if (request.need === 'verify') {
      this.limiter.easeIn();
      await this.limiter.cooldown(Date.now() + randomBetween(3, 6) * 60_000, 'Easing back in after X’s check');
    } else {
      await this.limiter.cooldown(Date.now() + randomBetween(10, 20) * 1000, 'Continuing shortly');
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

  /** Paced navigation, counted against the page-load caps and the read budget of the page (one fifth of X's quota). */
  async navigate(url: string) {
    this.checkpoint();
    this.readBudget = readBudgetFor(url);
    await this.limiter.before('read', this.readBudget);
    this.status(`Opening ${url.replace('https://x.com', '')}`);
    const info = await workerTab.navigate(url, this.signal);
    this.limiter.after('read', 'done', this.readBudget);
    this.assertPage(info);
    try {
      const content = await workerTab.send({ cmd: 'waitContent', timeoutMs: 20_000 });
      // No posts can mean X moved the page to its login or a check.
      if (content.kind !== 'tweets') await this.verifyPage();
      return content;
    } catch (err) {
      if (!(err instanceof NotReady)) throw err;
      // The page reloaded while loading — X redirecting to its login or a check page does that.
      this.assertPage(await workerTab.waitReady(this.signal, info.bootId));
      throw err;
    }
  }

  /** Paced scroll in the worker page; it loads more of the current page, so it spends that page's read budget. */
  async scroll() {
    this.checkpoint();
    await this.limiter.before('read', this.readBudget);
    const result = await workerTab.send({ cmd: 'scroll' });
    this.limiter.after('read', 'done', this.readBudget);
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
    const markTried = (patch: Partial<Item> = {}) =>
      item ? db.items.update(item.key, { lastJobId: this.job.id, ...patch }) : Promise.resolve(0);

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
        const until =
          result.resetAt && result.resetAt > Date.now()
            ? result.resetAt + randomBetween(10_000, 30_000)
            : Date.now() + randomBetween(15, 20) * 60_000;
        await this.log(
          'warn',
          action,
          `X rate limit hit; resuming at ${new Date(until).toLocaleTimeString()}`,
          target,
          outcome,
        );
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
        throw new NeedsYou('verify', needMessage('verify', this.handle), true);

      case 'logged_out':
        await this.log('error', action, `Logged out${detail}`, target, outcome);
        throw new NeedsYou('login', needMessage('login', this.handle), true);

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

/** A failed reload while waiting is fine (the person may be mid-login); a closed window or Pause is not. */
function rethrowIfStopped(err: unknown) {
  if (err instanceof Aborted || err instanceof WorkerGone) throw err;
}

const VERB: Record<ActionKind, string> = {
  delete: 'Deleted',
  unretweet: 'Undid repost',
  unlike: 'Unliked',
  relike: 'Removed ghost like',
  read: 'Loaded page',
};
