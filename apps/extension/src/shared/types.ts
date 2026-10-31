/** Kind of an inventory item. `post`, `reply` and `repost` are the account's own; `like` is a post it liked. */
export type ItemKind = 'post' | 'reply' | 'repost' | 'like';
/**
 * Where an item stands on X. `deleted`: a Xomoni action on it succeeded (delete, unlike or undo repost).
 * `gone`: X reported it missing or already undone, so there was nothing to act on. A live sighting more than
 * 5 s after either mark sets it back to `present` (see `upsertItems`).
 */
export type ItemStatus = 'present' | 'deleted' | 'gone';
/** How an item entered the inventory: `archive` from an imported X data archive, `scan` from X responses seen live. */
export type ItemSource = 'archive' | 'scan';

/** One thing on the account that can be cleaned up. */
export interface Item {
  /** `${accountId}:${kind}:${id}` */
  key: string;
  accountId: string;
  kind: ItemKind;
  /** post/reply: the post id · repost: the repost's own status id · like: the liked post id */
  id: string;
  /** The id rendered on screen: equals `id` except for reposts, where it is the original post ('' if unknown). */
  targetId: string;
  /** When the post was created (for reposts: when you reposted it). */
  createdAt: number;
  /** Estimated time you liked it (likes only, when derivable). */
  likedAt: number | null;
  text: string;
  /** Handle of the original author (own handle for posts/replies). */
  author: string;
  inReplyToId: string | null;
  /** Reply to one of your own posts (a thread continuation). */
  selfReply: boolean;
  /**
   * Engagement counts as last reported by X; archive values until a live scan refreshes them.
   * For reposts and likes they are the original post's counts.
   */
  likes: number;
  reposts: number;
  replies: number;
  /** Every source that has reported this item. */
  sources: ItemSource[];
  status: ItemStatus;
  /** Last time X showed it to us live (0 = archive only). */
  seenAt: number;
  /** Epoch ms of the last `status` change, or of the first insert. */
  statusAt: number;
  /** Last job that tried to act on it. */
  lastJobId: string | null;
}

/** Item fields known at extraction time, before merging into the store. */
export type ItemDraft = Pick<
  Item,
  | 'kind'
  | 'id'
  | 'targetId'
  | 'createdAt'
  | 'likedAt'
  | 'text'
  | 'author'
  | 'inReplyToId'
  | 'selfReply'
  | 'likes'
  | 'reposts'
  | 'replies'
>;

/**
 * An X account Xomoni has seen, keyed by X's numeric user id (`rest_id`, also in the `twid` cookie).
 * Profile fields come from `UserByScreenName` responses.
 */
export interface Account {
  id: string;
  /** Screen name without the `@`. */
  handle: string;
  name: string;
  avatar: string;
  /** Profile counters from X; null until a profile response is seen. */
  postsCount: number | null;
  likesCount: number | null;
  followers: number | null;
  following: number | null;
  /** When the X account was created (epoch ms); the history scan starts from this year. */
  createdAt: number | null;
  updatedAt: number;
}

/** The item kind a cleanup job removes. One job handles one kind; `actionFor` maps it to an action. */
export type CleanupTarget = 'post' | 'reply' | 'repost' | 'like';

/**
 * The rules of a cleanup job. An item is removed only when it is `present`, inside the date bounds and no
 * keep rule applies (see `matchesFilter`). Dates compare against `effectiveTime`.
 */
export interface CleanupFilter {
  target: CleanupTarget;
  /** Exclusive upper bound (epoch ms). */
  before: number;
  /** Inclusive lower bound (epoch ms) or null. */
  after: number | null;
  /**
   * Keep posts and replies with at least this many likes; ignored for reposts and likes. When set, cleanup
   * acts only on items whose like count was seen live during the run.
   */
  keepMinLikes: number | null;
  /** Lowercased keywords; an item whose text contains any of them is kept. */
  keepKeywords: string[];
  /** Post ids to keep, matched against both `id` and `targetId`. */
  keepIds: string[];
  /** Keep replies to your own posts (thread continuations). Applies only when `target` is `reply`. */
  skipSelfReplies: boolean;
}

/** Strategy switches for a cleanup job. The sweep runs before the deep clean (see engine/cleanup.ts). */
export interface CleanupOptions {
  /** Sweep X search / timelines and act in place. */
  sweep: boolean;
  /** Visit remaining inventory items (e.g. from the archive) one by one. */
  deep: boolean;
  /** Re-like then unlike posts X no longer shows as liked. */
  ghostLikes: boolean;
}

/**
 * What a scan job reads: the profile timeline, the replies tab, the Likes timeline, or (`history`) X search
 * in half-year windows to reach posts older than the ~3,200 the profile shows.
 */
export type ScanTarget = 'posts' | 'replies' | 'likes' | 'history';

/** A `cleanup` job changes the account; a `scan` job only reads X to fill the inventory. */
export type JobKind = 'cleanup' | 'scan';
/** waiting = running, but paused until the person completes a login or X check. */
export type JobState = 'queued' | 'running' | 'waiting' | 'paused' | 'blocked' | 'completed' | 'cancelled' | 'failed';

/** Counters for a job, saved with it and kept across resumes. */
export interface JobStats {
  /** Cleanup only: items settled so far plus the inventory items that still match. */
  matched: number;
  /** Actions X confirmed. */
  done: number;
  /** Items X reported as missing or already undone. */
  skipped: number;
  /** Actions that failed; the item stays `present` for a later job. */
  failed: number;
  /** Posts looked at on X pages during scans and sweeps. */
  scanned: number;
}

/**
 * A cleanup or scan job, stored in the `jobs` table. Jobs are resumable: a new run of the same job skips
 * what earlier runs settled.
 */
export interface Job {
  id: string;
  accountId: string;
  kind: JobKind;
  title: string;
  /** Cleanup jobs only; null for scans. */
  filter: CleanupFilter | null;
  /** Cleanup jobs only; null for scans. */
  options: CleanupOptions | null;
  /** Scan jobs only; null for cleanups. */
  scan: ScanTarget | null;
  state: JobState;
  /** Resume marker: `sweep` or `deep` for cleanups, `<page>/<pages>` for scans; empty before the first run. */
  phase: string;
  /**
   * Scans only: `stats.scanned` when the page in `phase` started. A run that loads that page again (after a
   * pause or an interruption) counts from here, so its posts are not counted twice.
   */
  scannedAtPageStart?: number;
  /** Why the job is in its state, shown to the person; empty while it runs normally. */
  stateReason: string;
  stats: JobStats;
  createdAt: number;
  /** First start (epoch ms); kept across resumes. */
  startedAt: number | null;
  /** Set when the job completes, is cancelled or fails; a paused or blocked job can still resume. */
  finishedAt: number | null;
  updatedAt: number;
}

/**
 * An action the limiter paces, each with its own `PacingRule`. `relike` is the ghost-like cleanup (like,
 * then unlike); `read` is a page load or scroll in the worker tab.
 */
export type ActionKind = 'delete' | 'unretweet' | 'unlike' | 'relike' | 'read';

/**
 * How X answered one action, classified in content/actor.ts from X's own response. `JobContext.settle`
 * turns it into done, skip, wait, retry or stop.
 * @remarks X error codes: `rate_limited` 429 or 88, `daily_limit` 185/344, `automation_flag` 226, `locked`
 * 326, `suspended` 64, `restricted` 87/220/261 or HTTP 403 on a write (or X's "limited" banner),
 * `logged_out` 32/89/215/353, `not_found` 34/144, `already` 139/327.
 */
export type Outcome =
  | 'done'
  | 'already'
  | 'not_found'
  | 'skipped'
  | 'rate_limited'
  | 'daily_limit'
  | 'automation_flag'
  | 'locked'
  | 'suspended'
  | 'restricted'
  | 'logged_out'
  | 'failed';

/** Severity of an activity log entry. */
export type LogLevel = 'info' | 'success' | 'warn' | 'error';

/**
 * One row of the activity log (`logs` table), written with `addLog`. Rows with `outcome: 'done'` from the
 * last 24 h seed the limiter's rolling caps when a job starts.
 */
export interface LogEntry {
  /** Auto-increment key, set by IndexedDB. */
  seq?: number;
  /** Epoch ms, set by `addLog`. */
  ts: number;
  accountId: string;
  jobId: string | null;
  level: LogLevel;
  /** `system` for job events that are not an action on a post. */
  action: ActionKind | 'system';
  /** The post id the entry is about, if any. */
  targetId: string | null;
  outcome: Outcome | null;
  message: string;
}

/** Rate-limit headers X returned for one of its own GraphQL operations. */
export interface RateObservation {
  /** `${accountId}:${op}` */
  key: string;
  accountId: string;
  op: string;
  /** `x-rate-limit-limit` and `x-rate-limit-remaining`; null when X did not send them. */
  limit: number | null;
  remaining: number | null;
  /** Epoch ms when the window resets. */
  reset: number | null;
  /** HTTP status of the response; 429 means the window is exhausted. */
  status: number;
  /** Epoch ms when the response was seen. */
  at: number;
}

/**
 * Pacing for one action kind. Delays and pauses are in seconds. Caps count only successful actions, in
 * rolling windows (any 60 min, any 24 h).
 */
export interface PacingRule {
  /** Seconds between actions (random in [min, max]). */
  minDelay: number;
  maxDelay: number;
  /** After this many actions, take a longer break. */
  batchSize: number;
  /** Seconds. */
  batchPauseMin: number;
  batchPauseMax: number;
  /** Successful actions allowed in any rolling hour. */
  hourlyCap: number;
  /** Successful actions allowed in any rolling 24 hours. */
  dailyCap: number;
}

/** A pacing preset from `PRESETS`; `custom` means the person edited the numbers. */
export type PresetName = 'careful' | 'custom';

/** The person's settings, stored under the `settings` key of the `kv` table. Read them with `getSettings`. */
export interface Settings {
  preset: PresetName;
  pacing: Record<ActionKind, PacingRule>;
  /** Local hours 0–23. When enabled, the limiter waits outside [start, end); the window may wrap past midnight. */
  activeHours: { enabled: boolean; start: number; end: number };
  /** Failed actions in a row that pause the job. */
  maxConsecutiveFailures: number;
  /** Desktop notifications when X needs you and when a job ends. */
  notifications: boolean;
}
