// Shared state and safety policy for one job run.
import { type Need, needMessage, pageNeed } from '../shared/attention';
import { addLog, db, getSettings, recordRisk } from '../shared/db';
import { RISK_LABELS, type RiskAssessment, type RiskEventKind, assessRisk } from '../shared/risk';
import type { ActionResult, PageInfo } from '../shared/messages';
import { DAY, HOUR } from '../shared/time';
import type { ActionKind, Item, Job, JobState, LogLevel, Outcome, Settings } from '../shared/types';
import { BUDGETS, type BudgetId, quotaHit, readBudgetFor } from '../shared/x-limits';
import { Limiter } from './limiter';
import { Aborted, randomBetween, sleep } from './timers';
import { NotReady, WorkerGone, workerTab } from './worker-tab';

/** How long a job waits for the person before pausing. */
const WAIT_FOR_YOU_MS = HOUR;
/** The page must look right this long before continuing (X redirects mid-login). */
const SETTLED_MS = 5000;
/** The same check this many times with no progress in between means waiting won't help. */
const MAX_REPEAT_NEEDS = 3;
/** Connection or X trouble this long with no progress pauses the job. */
const OUTAGE_LIMIT_MS = 3 * HOUR;
/** How often to check whether the browser is back online. */
const ONLINE_CHECK_MS = 10_000;

/** Whether the browser has a network connection. True where `navigator` is missing. */
const online = () => globalThis.navigator?.onLine !== false;

/** What to do when X limits the account; shown when a job stops for a restriction. */
const RESTRICTED_ADVICE =
  'The account may be limited or read-only. Xomoni stopped at the first refusal and won’t retry. Use X normally, wait until X lifts the limit, then resume with the Careful preset.';

/** Thrown to end a run; `state` is what the job becomes. */
export class Stop extends Error {
  constructor(
    public state: Extract<JobState, 'paused' | 'blocked' | 'failed' | 'cancelled'>,
    message: string,
    /** A risk-ladder event the runner records for this stop (see `risk.ts`), when it hasn't been already. */
    public risk?: RiskEventKind,
  ) {
    super(message);
  }
}

const timeOf = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Why a job may not run now under the risk ladder, or null when it may. Full stops never end on their own;
 * resume locks end at `resumeAt`.
 */
export function riskBlock(risk: RiskAssessment): string | null {
  if (risk.fullStop) {
    return `Risk level 4 (Full stop): ${risk.reason}. Xomoni won’t resume on its own. Rest the account, and resume only if you decide to, by typing your confirmation.`;
  }
  if (risk.resumeAt) {
    return `Risk level ${risk.level} (${RISK_LABELS[risk.level]}): ${risk.reason}. Resume is locked until ${timeOf(risk.resumeAt)}. Use X normally meanwhile.`;
  }
  return null;
}

/** What interrupted a run: the connection or X's servers. A worker page that stops answering is `NotReady`. */
export type InterruptionKind = 'offline' | 'outage';

/**
 * Thrown when the connection drops or X's servers fail. Neither says anything about the posts, so nothing is
 * counted as failed: the runner waits it out (`JobContext.waitOut`) and runs the job's steps again (PLAYBOOK
 * F6).
 */
export class Interrupted extends Error {
  constructor(
    public kind: InterruptionKind,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What an HTTP status from X means for the run: `offline` when the browser is offline or the request got no
 * answer (status 0), `outage` for X's server errors (5xx), and null for anything else.
 */
export function interruptionOf(http: number | null | undefined, isOnline: boolean): InterruptionKind | null {
  if (!isOnline || http === 0) return 'offline';
  if (http != null && http >= 500) return 'outage';
  return null;
}

/** Minutes to wait after the `n`th interruption in a row with no progress (from 1): 1, 2, 4, 8, 16, then 30. */
export function backoffMinutes(n: number): number {
  return Math.min(30, 2 ** Math.max(0, n - 1));
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
  /** Actions whose check before acting passed in this run (PLAYBOOK F1); each run checks again. */
  preflighted = new Set<ActionKind>();
  /** Read budget of the page the worker tab shows; scrolls spend it too. */
  private readBudget: BudgetId = 'userTimeline';
  private consecutiveFailures = 0;
  private repeatNeeds = 0;
  private progressAtLastNeed = -1;
  private outages = 0;
  private outageSince = 0;
  private progressAtOutage = -1;

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
    // The risk ladder: a full stop or a resume lock ends the run before it touches X (PLAYBOOK §7).
    const blocked = riskBlock(this.limiter.risk);
    if (blocked) throw new Stop('blocked', blocked);
  }

  /** Records a risk event and returns the ladder's view afterwards. */
  private async risk(kind: RiskEventKind): Promise<RiskAssessment> {
    return assessRisk(await recordRisk(this.job.accountId, kind), Date.now());
  }

  /** Items settled plus posts looked at: it grows whenever the run gets anywhere. */
  private progress() {
    const { done, skipped, failed, scanned } = this.job.stats;
    return done + skipped + failed + scanned;
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
    await workerTab.keepLoaded();
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

  /**
   * Login, X checks and account switches all need the person, not a retry. A suspension or limitation
   * notice on the page stops the job: waiting can't fix it (PLAYBOOK C3, C4).
   */
  assertPage(info: PageInfo) {
    if (info.restriction) {
      throw new Stop(
        'blocked',
        `X shows a restriction on this account: “${info.restriction}”. ${RESTRICTED_ADVICE}`,
        /suspend/i.test(info.restriction) ? 'suspended' : 'restricted',
      );
    }
    // X's session cookie is shared by every x.com tab, so switching accounts anywhere switches the worker too.
    const need = pageNeed(info, this.job.accountId);
    if (need) throw new NeedsYou(need, needMessage(need, this.handle));
  }

  /**
   * Waits — without acting — until the person has done what X asked for in the
   * worker window. Pauses the job if that takes longer than an hour.
   */
  async waitForYou(request: NeedsYou) {
    const progress = this.progress();
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
      // After an X check or a lock, rest 60–90 minutes before acting again (PLAYBOOK C2).
      this.limiter.easeIn();
      await this.limiter.cooldown(Date.now() + randomBetween(60, 90) * 60_000, 'Resting after X’s check (60–90 min)');
    } else {
      await this.limiter.cooldown(Date.now() + randomBetween(10, 20) * 1000, 'Continuing shortly');
    }
  }

  /**
   * Waits out an interruption without counting a failure (PLAYBOOK F5, F6). Offline, it checks every 10 s
   * until the browser is back online. A worker tab Chrome unloaded is reloaded by `connect` right away, the
   * first time. Otherwise it waits 1, 2, 4 … up to 30 minutes, doubling while nothing moves. Pauses the job
   * after three hours without progress.
   */
  async waitOut(err: Interrupted | NotReady) {
    const progress = this.progress();
    if (progress !== this.progressAtOutage) {
      this.progressAtOutage = progress;
      this.outages = 0;
      this.outageSince = Date.now();
    }
    this.outages++;
    const giveUpIfTooLong = () => {
      if (Date.now() - this.outageSince >= OUTAGE_LIMIT_MS) {
        throw new Stop(
          'paused',
          `${err.message}, and nothing worked for three hours. Resume when X and your connection work again.`,
        );
      }
    };
    giveUpIfTooLong();
    await this.log('warn', 'system', `${err.message}. Waiting; nothing is counted as failed`);

    if (!online()) {
      while (!online()) {
        giveUpIfTooLong();
        await this.limiter.cooldown(Date.now() + ONLINE_CHECK_MS, 'Waiting for the internet connection');
      }
      await this.limiter.cooldown(Date.now() + randomBetween(20, 40) * 1000, 'Back online — continuing shortly');
      return;
    }
    if (this.outages === 1 && (await workerTab.discarded())) {
      await this.log('info', 'system', 'Chrome unloaded the X tab to save memory; reloading it');
      return;
    }
    const minutes = backoffMinutes(this.outages);
    const what =
      err instanceof Interrupted && err.kind === 'outage' ? 'X is having trouble' : 'The X page stopped answering';
    await this.limiter.cooldown(
      Date.now() + minutes * 60_000 * randomBetween(1, 1.2),
      `${what} — trying again in about ${minutes} min`,
    );
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
    // Offline, a page load would only show Chrome's error page.
    if (!online()) throw new Interrupted('offline', 'The internet connection dropped');
    this.readBudget = readBudgetFor(url);
    await this.limiter.before('read', this.readBudget);
    this.status(`Opening ${url.replace('https://x.com', '')}`);
    const info = await workerTab.navigate(url, this.signal);
    this.limiter.after('read', 'done', this.readBudget);
    this.assertPage(info);
    try {
      const content = await workerTab.send({ cmd: 'waitContent', timeoutMs: 20_000 });
      if (content.kind !== 'tweets') {
        // No posts can mean X moved the page to its login or a check…
        await this.verifyPage();
        // …or that X or the connection failed, which says nothing about the posts.
        const kind = interruptionOf(content.http, online());
        if (kind === 'outage') throw new Interrupted(kind, `X answered HTTP ${content.http} for this page`);
        if (kind) throw new Interrupted(kind, 'The page got no answer from X; the connection may have dropped');
      }
      return content;
    } catch (err) {
      if (!(err instanceof NotReady)) throw err;
      // The page reloaded while loading — X redirecting to its login or a check page does that.
      this.assertPage(await workerTab.waitReady(this.signal, info.bootId));
      throw err;
    }
  }

  /**
   * Whether X refused the current page for its quota since `since` (epoch ms): a 429, or nothing remaining, on
   * any request of the page's read budget. Returns it as a `rate_limited` result for `settle`, or null. X's
   * answer may be stored a moment after the page shows its error, so this looks for up to two seconds.
   */
  async pageRateLimit(since: number): Promise<ActionResult | null> {
    const budget = BUDGETS[this.readBudget];
    for (let look = 0; look < 4; look++) {
      for (const op of budget.ops) {
        const obs = await db.limits.get(`${this.job.accountId}:${op}`);
        if (quotaHit(obs, since)) {
          return { outcome: 'rate_limited', resetAt: obs.reset, message: `${budget.label}: X’s rate limit reached` };
        }
      }
      await sleep(500, this.signal);
    }
    return null;
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
        // Two rate limits within an hour put the account on the Retreat rung: stop instead of waiting.
        const blocked = riskBlock(await this.risk('rate_limited'));
        if (blocked) throw new Stop('blocked', blocked);
        // X's reset time plus 30–90 s, so the next request never lands right on the edge of X's window.
        const until =
          result.resetAt && result.resetAt > Date.now()
            ? result.resetAt + randomBetween(30_000, 90_000)
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

      case 'automation_flag': {
        await this.log('error', action, `X flagged this activity as automated${detail}`, target, outcome);
        const risk = await this.risk('automation_flag');
        throw new Stop(
          'blocked',
          riskBlock(risk) ??
            'X flagged the activity as automated (error 226). Stop for several hours, use X normally, then resume.',
        );
      }

      case 'suspended':
        await this.log('error', action, `Account suspended${detail}`, target, outcome);
        await this.risk('suspended');
        throw new Stop(
          'blocked',
          'X suspended this account (code 64). Waiting can’t fix this, so Xomoni stopped and won’t continue on its own. Check X for details.',
        );

      case 'restricted':
        await this.log('error', action, `X refused the action${detail}`, target, outcome);
        await this.risk('restricted');
        throw new Stop('blocked', `X refused the action${detail}. ${RESTRICTED_ADVICE}`);

      case 'locked': {
        await this.log('error', action, `Account locked${detail}`, target, outcome);
        const blocked = riskBlock(await this.risk('lock'));
        if (blocked) throw new Stop('blocked', blocked);
        throw new NeedsYou('verify', needMessage('verify', this.handle), true);
      }

      case 'logged_out':
        await this.log('error', action, `Logged out${detail}`, target, outcome);
        throw new NeedsYou('login', needMessage('login', this.handle), true);

      default: {
        // A dropped connection or an X server error says nothing about the post (PLAYBOOK F6).
        const kind = interruptionOf(result.http, online());
        if (kind) {
          const message =
            kind === 'outage' ? `X answered HTTP ${result.http}` : 'X did not answer; the connection may have dropped';
          // Logged with its outcome so later runs count the request against X's quota; the post is not failed.
          await this.log('warn', action, `${message} — not counted as failed`, target, outcome);
          throw new Interrupted(kind, message);
        }
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
