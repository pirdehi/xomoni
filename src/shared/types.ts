export type ItemKind = 'post' | 'reply' | 'repost' | 'like';
export type ItemStatus = 'present' | 'deleted' | 'gone';
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
  likes: number;
  reposts: number;
  replies: number;
  sources: ItemSource[];
  status: ItemStatus;
  /** Last time X showed it to us live (0 = archive only). */
  seenAt: number;
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

export interface Account {
  id: string;
  handle: string;
  name: string;
  avatar: string;
  postsCount: number | null;
  likesCount: number | null;
  followers: number | null;
  following: number | null;
  createdAt: number | null;
  updatedAt: number;
}

export type CleanupTarget = 'post' | 'reply' | 'repost' | 'like';

export interface CleanupFilter {
  target: CleanupTarget;
  /** Exclusive upper bound (epoch ms). */
  before: number;
  /** Inclusive lower bound (epoch ms) or null. */
  after: number | null;
  keepMinLikes: number | null;
  keepKeywords: string[];
  keepIds: string[];
  skipSelfReplies: boolean;
}

export interface CleanupOptions {
  /** Sweep X search / timelines and act in place. */
  sweep: boolean;
  /** Visit remaining inventory items (e.g. from the archive) one by one. */
  deep: boolean;
  /** Re-like then unlike posts X no longer shows as liked. */
  ghostLikes: boolean;
}

export type ScanTarget = 'posts' | 'replies' | 'likes' | 'history';

export type JobKind = 'cleanup' | 'scan';
/** waiting = running, but paused until the person completes a login or X check. */
export type JobState = 'queued' | 'running' | 'waiting' | 'paused' | 'blocked' | 'completed' | 'cancelled' | 'failed';

export interface JobStats {
  matched: number;
  done: number;
  skipped: number;
  failed: number;
  scanned: number;
}

export interface Job {
  id: string;
  accountId: string;
  kind: JobKind;
  title: string;
  filter: CleanupFilter | null;
  options: CleanupOptions | null;
  scan: ScanTarget | null;
  state: JobState;
  phase: string;
  stateReason: string;
  stats: JobStats;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
}

export type ActionKind = 'delete' | 'unretweet' | 'unlike' | 'relike' | 'read';

export type Outcome =
  | 'done'
  | 'already'
  | 'not_found'
  | 'skipped'
  | 'rate_limited'
  | 'daily_limit'
  | 'automation_flag'
  | 'locked'
  | 'logged_out'
  | 'failed';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  seq?: number;
  ts: number;
  accountId: string;
  jobId: string | null;
  level: LogLevel;
  action: ActionKind | 'system';
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
  limit: number | null;
  remaining: number | null;
  /** Epoch ms when the window resets. */
  reset: number | null;
  status: number;
  at: number;
}

export interface PacingRule {
  /** Seconds between actions (random in [min, max]). */
  minDelay: number;
  maxDelay: number;
  /** After this many actions, take a longer break. */
  batchSize: number;
  /** Seconds. */
  batchPauseMin: number;
  batchPauseMax: number;
  hourlyCap: number;
  dailyCap: number;
}

export type PresetName = 'careful' | 'balanced' | 'custom';

export interface Settings {
  preset: PresetName;
  pacing: Record<ActionKind, PacingRule>;
  activeHours: { enabled: boolean; start: number; end: number };
  maxConsecutiveFailures: number;
  /** Desktop notifications when X needs you and when a job ends. */
  notifications: boolean;
}
