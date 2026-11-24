// The messages xomoni.com and the Xomoni extension exchange inside one browser, through `externally_connectable`
// (ADR-0024, ADR-0025). One contract for both apps: the website builds messages and reads answers with it, and the
// extension's service worker parses messages with it. Every parser is strict: the exact keys and shapes, anything else
// is null (or, for an answer, a refusal). Nothing here carries X content (ADR-0004). An action can ask the extension to
// stop or to open its own page; it can never start, resume or approve work on X, which only the person does in
// Xomoni (ADR-0027).

export {
  EXTENSION_ID,
  type ManifestKey,
  STORE_EXTENSION_IDS,
  type Store,
  isExtensionId,
  manifestKeyProblems,
  readManifestKey,
  storeExtensionIds,
} from './extension-ids';
export {
  REACH_BANNED_WORDS,
  REACH_VERDICTS,
  REACH_VERDICT_WORDS,
  type ReachVerdict,
  usesBannedReachWord,
} from './reach';

/** xomoni.com's origin: the only one the extension's `externally_connectable` lists, checked again on every message. */
export const WEBSITE_ORIGIN = 'https://xomoni.com';

/** Asks the extension how it stands: its version, its xomoni.com connection and its signed-out state. */
export const HELLO = 'xomoni-hello';
/** Signs the extension in to the account the page is signed in to, with a one-time code that account made. */
export const SIGN_IN = 'xomoni-sign-in';
/** Signs the extension out of Xomoni because the person signed out on xomoni.com in this browser. */
export const SIGN_OUT = 'xomoni-sign-out';
/** Hands over the one-time code of a connection the extension asked for, with its nonce (ADR-0024). */
export const PAIR = 'xomoni-pair';
/**
 * Asks the extension to pause, cancel or resume one of its jobs (ADR-0027). Pausing and cancelling apply at once;
 * resuming only opens Xomoni's own confirmation.
 */
export const JOB = 'xomoni-job';
/** Asks the extension to open one of its own pages (ADR-0027). */
export const OPEN = 'xomoni-open';

/** A one-time pairing code, with or without its dash (ADR-0018). */
export const PAIRING_CODE = /^[0-9A-Za-z]{5}-?[0-9A-Za-z]{5}$/;
/** A connection request's nonce: base64url, 128 bits or more (ADR-0024). */
export const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
/** A device's id on xomoni.com: a UUID. */
export const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A job's id in the extension, as xomoni.com knows it (`jobs.local_id`): 1 to 64 letters, digits, `-` or `_`. */
export const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What the website may ask of a job. */
export type JobAction = 'pause' | 'cancel' | 'resume';

/** Every `JobAction`, for the parser. */
export const JOB_ACTIONS: readonly JobAction[] = ['pause', 'cancel', 'resume'];

/** The pages of Xomoni the website may open. */
export type XomoniPage = 'overview' | 'activity' | 'cleanup' | 'library' | 'vault' | 'reach' | 'watch' | 'settings';

/** Every `XomoniPage`, for the parser. */
export const XOMONI_PAGES: readonly XomoniPage[] = [
  'overview',
  'activity',
  'cleanup',
  'library',
  'vault',
  'reach',
  'watch',
  'settings',
];

/** `{type: 'xomoni-hello'}`. */
export interface HelloMessage {
  type: typeof HELLO;
}

/**
 * `{type: 'xomoni-sign-in', code}`, from a signed-in page. `replace` names the device the extension is connected as
 * when the page found it belongs to another account: only then does the extension drop that connection first.
 */
export interface SignInMessage {
  type: typeof SIGN_IN;
  code: string;
  replace?: string;
}

/** `{type: 'xomoni-sign-out'}`. */
export interface SignOutMessage {
  type: typeof SIGN_OUT;
}

/** `{type: 'xomoni-pair', code, nonce}` (ADR-0024). */
export interface PairMessage {
  type: typeof PAIR;
  code: string;
  nonce: string;
}

/**
 * `{type: 'xomoni-job', action, deviceId, jobId}` (ADR-0027). `deviceId` is the browser the job runs in, from the
 * page's own account: the extension acts only when it is connected as that device.
 */
export interface JobMessage {
  type: typeof JOB;
  action: JobAction;
  deviceId: string;
  jobId: string;
}

/** `{type: 'xomoni-open', page, deviceId}` (ADR-0027): opens one of Xomoni's pages, nothing else. */
export interface OpenMessage {
  type: typeof OPEN;
  page: XomoniPage;
  deviceId: string;
}

/** Everything xomoni.com may send the extension. */
export type WebsiteMessage =
  | HelloMessage
  | SignInMessage
  | SignOutMessage
  | PairMessage
  | JobMessage
  | OpenMessage
  | ReadMessage
  | SettingsMessage
  | PlanMessage;

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/** `raw` as a message from the website, or null unless it is exactly one of `WebsiteMessage`'s shapes. */
export function parseWebsiteMessage(raw: unknown): WebsiteMessage | null {
  const value = record(raw);
  if (!value) return null;
  switch (value.type) {
    case HELLO:
      return onlyKeys(value, ['type']) ? { type: HELLO } : null;
    case SIGN_OUT:
      return onlyKeys(value, ['type']) ? { type: SIGN_OUT } : null;
    case SIGN_IN: {
      if (!onlyKeys(value, ['type', 'code', 'replace'])) return null;
      const code = matching(value.code, PAIRING_CODE);
      if (!code) return null;
      if (value.replace === undefined) return { type: SIGN_IN, code };
      const replace = matching(value.replace, DEVICE_ID);
      return replace ? { type: SIGN_IN, code, replace } : null;
    }
    case PAIR: {
      if (!onlyKeys(value, ['type', 'code', 'nonce'])) return null;
      const code = matching(value.code, PAIRING_CODE);
      const nonce = matching(value.nonce, NONCE);
      return code && nonce ? { type: PAIR, code, nonce } : null;
    }
    case JOB: {
      if (!onlyKeys(value, ['type', 'action', 'deviceId', 'jobId'])) return null;
      const action = JOB_ACTIONS.find((a) => a === value.action);
      const deviceId = matching(value.deviceId, DEVICE_ID);
      const jobId = matching(value.jobId, JOB_ID);
      return action && deviceId && jobId ? { type: JOB, action, deviceId, jobId } : null;
    }
    case OPEN: {
      if (!onlyKeys(value, ['type', 'page', 'deviceId'])) return null;
      const page = XOMONI_PAGES.find((p) => p === value.page);
      const deviceId = matching(value.deviceId, DEVICE_ID);
      return page && deviceId ? { type: OPEN, page, deviceId } : null;
    }
    case READ:
      return parseReadMessage(value);
    case SETTINGS:
      return parseSettingsMessage(value);
    case PLAN:
      return parsePlanMessage(value);
    default:
      return null;
  }
}

/** The extension's link to a xomoni.com account, as a page may see it: never the token. */
export interface ExtensionConnection {
  /** The device on xomoni.com. */
  deviceId: string;
  /** The account's email, masked (`o•••@example.com`). */
  account: string;
  /** When this browser was connected (epoch ms, this computer's clock). */
  connectedAt: number;
}

/** How the extension stands, as `xomoni-hello` answers. Times are epoch ms on this computer's clock. */
export interface ExtensionState {
  /** The extension's version. */
  version: string;
  /** The xomoni.com account it reports to, or null. */
  connection: ExtensionConnection | null;
  /** Since when it is signed out of Xomoni (ADR-0023), or null while signed in. */
  signedOutAt: number | null;
  /**
   * The last time the person ended the xomoni.com link in the extension: signing out of Xomoni there, or signing out
   * of xomoni.com there. 0 when never. A website session started before it is signed out too (ADR-0025).
   */
  leftAt: number;
}

function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseConnection(raw: unknown): ExtensionConnection | null | undefined {
  if (raw === null) return null;
  const value = record(raw);
  const deviceId = matching(value?.deviceId, DEVICE_ID);
  const connectedAt = epoch(value?.connectedAt);
  if (!value || !deviceId || connectedAt === null || typeof value.account !== 'string') return undefined;
  return { deviceId, account: value.account.slice(0, 320), connectedAt };
}

/** The state in a `xomoni-hello` answer (`{ok: true, state}`), or null when the answer isn't one. */
export function parseExtensionState(raw: unknown): ExtensionState | null {
  const answer = record(raw);
  const state = record(answer?.state);
  if (answer?.ok !== true || !state) return null;
  const version = typeof state.version === 'string' && state.version.length <= 32 ? state.version : null;
  const connection = parseConnection(state.connection);
  const signedOutAt = state.signedOutAt === null ? null : epoch(state.signedOutAt);
  const leftAt = epoch(state.leftAt);
  if (version === null || connection === undefined || leftAt === null) return null;
  if (signedOutAt === null && state.signedOutAt !== null) return null;
  return { version, connection, signedOutAt, leftAt };
}

/** Why the extension didn't sign in. The pairing reasons come from `pair_device` (ADR-0018). */
export type SignInRefusal =
  'already_connected' | 'bad_code' | 'device_limit' | 'unreachable' | 'refused' | 'invalid' | 'no_answer';

/** The answer to `xomoni-sign-in`. */
export type SignInAnswer = { ok: true; account: string; deviceId: string } | { ok: false; reason: SignInRefusal };

const SIGN_IN_REFUSALS: readonly SignInRefusal[] = [
  'already_connected',
  'bad_code',
  'device_limit',
  'unreachable',
  'refused',
  'invalid',
];

/** `raw` as a sign-in answer: no answer at all is `no_answer`, and anything unexpected `refused`. */
export function parseSignInAnswer(raw: unknown): SignInAnswer {
  if (raw === undefined || raw === null) return { ok: false, reason: 'no_answer' };
  const answer = record(raw);
  if (answer?.ok === true) {
    const deviceId = matching(answer.deviceId, DEVICE_ID);
    if (deviceId) return { ok: true, account: typeof answer.account === 'string' ? answer.account : '', deviceId };
  }
  const reason = SIGN_IN_REFUSALS.find((r) => r === answer?.reason);
  return { ok: false, reason: reason ?? 'refused' };
}

/** The answer to `xomoni-sign-out`: `signedOut` is false when the extension wasn't connected, so nothing changed. */
export interface SignOutAnswer {
  ok: true;
  signedOut: boolean;
}

/** `raw` as a sign-out answer, or null when it isn't one. */
export function parseSignOutAnswer(raw: unknown): SignOutAnswer | null {
  const answer = record(raw);
  return answer?.ok === true && typeof answer.signedOut === 'boolean'
    ? { ok: true, signedOut: answer.signedOut }
    : null;
}

/**
 * What the extension did with an action:
 * - `stopping`: the job's run was asked to pause or cancel and stops after the action in flight;
 * - `cancelled`: a job that wasn't running is cancelled;
 * - `asked`: Xomoni opened its own confirmation, and nothing runs until the person says yes there;
 * - `opened`: Xomoni opened the page.
 */
export type ActionOutcome = 'stopping' | 'cancelled' | 'asked' | 'opened';

/**
 * Why the extension refused an action:
 * - `not_connected`, `signed_out`, `other_account`: it isn't signed in to the page's account as the device named;
 * - `no_job`: it has no such job;
 * - `not_running`: pause asked of a job that isn't running;
 * - `finished`: the job has ended, so there is nothing to cancel or resume;
 * - `invalid`, `refused`, `no_answer`: a message it didn't accept, an error, or no answer at all.
 */
export type ActionRefusal =
  | 'not_connected'
  | 'signed_out'
  | 'other_account'
  | 'no_job'
  | 'not_running'
  | 'finished'
  | 'invalid'
  | 'refused'
  | 'no_answer';

/** The answer to `xomoni-job` and `xomoni-open`. */
export type ActionAnswer = { ok: true; outcome: ActionOutcome } | { ok: false; reason: ActionRefusal };

const ACTION_OUTCOMES: readonly ActionOutcome[] = ['stopping', 'cancelled', 'asked', 'opened'];
const ACTION_REFUSALS: readonly ActionRefusal[] = [
  'not_connected',
  'signed_out',
  'other_account',
  'no_job',
  'not_running',
  'finished',
  'invalid',
  'refused',
];

/** `raw` as an action answer: no answer at all is `no_answer`, and anything unexpected `refused`. */
export function parseActionAnswer(raw: unknown): ActionAnswer {
  if (raw === undefined || raw === null) return { ok: false, reason: 'no_answer' };
  const answer = record(raw);
  if (answer?.ok === true) {
    const outcome = ACTION_OUTCOMES.find((o) => o === answer.outcome);
    if (outcome) return { ok: true, outcome };
  }
  const reason = ACTION_REFUSALS.find((r) => r === answer?.reason);
  return { ok: false, reason: reason ?? 'refused' };
}

// ── Reads (ADR-0028, #233) ───────────────────────────────────────────────────────────────────────
// The website reads Xomoni's own data in the same browser: the Library, account health and Watch. A read changes
// nothing, answers at most `READ_PAGE` items, and what it returns stays in the page's memory.

/** Asks the extension for one of its places' data (ADR-0028). */
export const READ = 'xomoni-read';

/**
 * What the website may read: `settings` too, under ADR-0029, a cleanup plan's estimate (#235), the person's replies
 * with whom each answers, the replies other people wrote to the person (`incoming`, ADR-0030) (#256), and the vault's
 * summary (`vault`, #426): counts and dates only, never a text or an id of X's.
 */
export type ReadWhat = 'library' | 'health' | 'watch' | 'settings' | 'cleanup' | 'replies' | 'incoming' | 'vault';

/** The kinds of item the Library holds. */
export type LibraryKind = 'post' | 'reply' | 'repost' | 'like';

/** Every `LibraryKind`, in the Library's order. */
export const LIBRARY_KINDS: readonly LibraryKind[] = ['post', 'reply', 'repost', 'like'];

/** Items a read answers at most. */
export const READ_PAGE = 100;

/** The longest search a Library read takes. */
export const MAX_READ_QUERY = 100;

/** The longest text an item or post carries in an answer. */
export const MAX_READ_TEXT = 1_000;

/**
 * Which of the person's replies to list (#256): all of them match the defaults. Times are epoch ms, and `replyTo` is
 * a handle without `@`. Only replies Xomoni knows are still on X are listed.
 */
export interface RepliesFilter {
  /** Only replies from this time on, or null. */
  after: number | null;
  /** Only replies older than this, or null. */
  before: number | null;
  /** Only replies with at most this many likes, or null. */
  maxLikes: number | null;
  /** Only replies to this handle, ignoring case; empty for anyone. */
  replyTo: string;
  /** Only replies whose text holds this, ignoring case; empty for any. */
  query: string;
  /** Whether replies in the person's own threads are listed too. */
  threads: boolean;
}

/**
 * `{type: 'xomoni-read', what, deviceId, …}`: the Library also takes a kind, a search and an offset, and the replies a
 * filter and an offset.
 */
export type ReadMessage =
  | { type: typeof READ; what: 'library'; deviceId: string; kind: LibraryKind; query: string; offset: number }
  | { type: typeof READ; what: 'health' | 'watch' | 'settings' | 'vault'; deviceId: string }
  | { type: typeof READ; what: 'cleanup'; deviceId: string; plan: CleanupPlan }
  | { type: typeof READ; what: 'replies'; deviceId: string; filter: RepliesFilter; offset: number }
  | { type: typeof READ; what: 'incoming'; deviceId: string; author: string; query: string; offset: number };

function readOffset(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e6 ? value : null;
}

/** `raw` as a replies filter, or null unless every field has its shape and the dates make sense. */
export function parseRepliesFilter(raw: unknown, now = Date.now()): RepliesFilter | null {
  const v = record(raw);
  const keys = ['after', 'before', 'maxLikes', 'replyTo', 'query', 'threads'];
  if (!v || !onlyKeys(v, keys) || keys.some((key) => !(key in v))) return null;
  const after = v.after === null ? null : (planTime(v.after, now) ?? undefined);
  const before = v.before === null ? null : (planTime(v.before, now) ?? undefined);
  const maxLikes = v.maxLikes === null ? null : (count(v.maxLikes) ?? undefined);
  const replyTo = matching(v.replyTo, HANDLE_TEXT);
  const query = typeof v.query === 'string' && v.query.length <= MAX_READ_QUERY ? v.query : null;
  if (after === undefined || before === undefined || maxLikes === undefined) return null;
  if (replyTo === null || query === null || typeof v.threads !== 'boolean') return null;
  if (after !== null && before !== null && after >= before) return null;
  if (maxLikes !== null && maxLikes > 1_000_000) return null;
  return { after, before, maxLikes, replyTo, query, threads: v.threads };
}

/** `raw` as a read message, or null unless it is exactly one of `ReadMessage`'s shapes. */
export function parseReadMessage(raw: unknown): ReadMessage | null {
  const value = record(raw);
  if (value?.type !== READ) return null;
  const deviceId = matching(value.deviceId, DEVICE_ID);
  if (!deviceId) return null;
  if (value.what === 'health' || value.what === 'watch' || value.what === 'settings' || value.what === 'vault') {
    return onlyKeys(value, ['type', 'what', 'deviceId']) ? { type: READ, what: value.what, deviceId } : null;
  }
  if (value.what === 'cleanup') {
    const plan = onlyKeys(value, ['type', 'what', 'deviceId', 'plan']) ? parsePlan(value.plan) : null;
    return plan ? { type: READ, what: 'cleanup', deviceId, plan } : null;
  }
  if (value.what === 'incoming') {
    if (!onlyKeys(value, ['type', 'what', 'deviceId', 'author', 'query', 'offset'])) return null;
    const author = matching(value.author, HANDLE_TEXT);
    const query = typeof value.query === 'string' && value.query.length <= MAX_READ_QUERY ? value.query : null;
    const offset = readOffset(value.offset);
    return author !== null && query !== null && offset !== null
      ? { type: READ, what: 'incoming', deviceId, author, query, offset }
      : null;
  }
  if (value.what === 'replies') {
    if (!onlyKeys(value, ['type', 'what', 'deviceId', 'filter', 'offset'])) return null;
    const filter = parseRepliesFilter(value.filter);
    const offset = readOffset(value.offset);
    return filter && offset !== null ? { type: READ, what: 'replies', deviceId, filter, offset } : null;
  }
  if (value.what !== 'library' || !onlyKeys(value, ['type', 'what', 'deviceId', 'kind', 'query', 'offset']))
    return null;
  const kind = LIBRARY_KINDS.find((k) => k === value.kind);
  const query = typeof value.query === 'string' && value.query.length <= MAX_READ_QUERY ? value.query : null;
  const offset = readOffset(value.offset);
  return kind && query !== null && offset !== null
    ? { type: READ, what: 'library', deviceId, kind, query, offset }
    : null;
}

/** One item of the Library, as the website shows it. `id` is X's post id, to link to the post. */
export interface LibraryItem {
  kind: LibraryKind;
  id: string;
  /** Whose post it is: the person's own handle, or, for reposts and likes, the original author's. */
  author: string;
  text: string;
  /** When it was posted (for a like, the liked post's time), epoch ms. */
  createdAt: number;
  likes: number;
  reposts: number;
  replies: number;
  /** Removed: Xomoni deleted it, or X no longer shows it. */
  removed: boolean;
}

/** An answer to a Library read: the account, counts per kind, a page of items and where the next page starts. */
export interface LibraryPage {
  handle: string;
  counts: Record<LibraryKind, { present: number; removed: number }>;
  /** Items matching the read, before paging. */
  matching: number;
  items: LibraryItem[];
  /** The offset of the next page, or null on the last one. */
  next: number | null;
}

/** One of the person's replies, as the Comments place shows it (#256). `id` is X's post id. */
export interface ReplyItem {
  id: string;
  /** Whose post it answers, without `@`; empty while Xomoni doesn't know. */
  replyTo: string;
  text: string;
  /** When it was posted, epoch ms. */
  createdAt: number;
  likes: number;
  reposts: number;
  replies: number;
  /** A reply in the person's own thread. */
  thread: boolean;
}

/** Someone, and how many replies: whom the person replies to (#256), or who replies to the person (ADR-0030). */
export interface RepliedTo {
  handle: string;
  replies: number;
}

/** The most people a replies read names. */
export const MAX_REPLIED_TO = 20;

/** An answer to a replies read: the account, a page of matching replies, and whom the person replies to most. */
export interface RepliesPage {
  handle: string;
  /** Replies Xomoni knows are still on X. */
  total: number;
  /** Of those, how many match the filter, before paging. */
  matching: number;
  items: ReplyItem[];
  /** The offset of the next page, or null on the last one. */
  next: number | null;
  /** Up to `MAX_REPLIED_TO` people replied to most, most first; the person's own threads left out. */
  people: RepliedTo[];
}

/** The most days of replies to the person Xomoni keeps, and so the most days an `incoming` answer counts (ADR-0030). */
export const INCOMING_DAYS = 90;

/** A reply someone else wrote to one of the person's posts, as Xomoni saw it (ADR-0030). Ids are X's post ids. */
export interface IncomingReply {
  id: string;
  /** Its author's handle, without `@`. */
  author: string;
  text: string;
  /** When it was posted, epoch ms. */
  createdAt: number;
  /** The person's post it answers. */
  toId: string;
}

/**
 * An answer to an `incoming` read: replies to the person Xomoni kept (at most `INCOMING_DAYS` days), how many each day,
 * who replies most, and a page of those matching the author and words asked for.
 */
export interface IncomingPage {
  handle: string;
  /** Replies kept now. */
  total: number;
  /** When the oldest kept reply was posted, or null without any: the counts start there. */
  since: number | null;
  /** Replies per local day (`YYYY-MM-DD`), days without any left out, oldest first. */
  perDay: { day: string; replies: number }[];
  /** Up to `MAX_REPLIED_TO` people who reply most, most first. */
  people: RepliedTo[];
  /** Replies matching the read, before paging. */
  matching: number;
  items: IncomingReply[];
  /** The offset of the next page, or null on the last one. */
  next: number | null;
}

/** One X account's health, as the risk ladder sees it now (ADR-0013). Times are epoch ms. */
export interface AccountHealth {
  handle: string;
  /** 0 (Normal) to 4 (Full stop). */
  level: number;
  /** Xomoni's own words for why; empty at level 0. */
  reason: string;
  /** Share of Xomoni's one-fifth allowance in use: 1, 0.5 or 0.25. */
  pace: number;
  reducedUntil: number | null;
  resumeAt: number | null;
  fullStop: boolean;
}

/** One Watch tab: what it searches, when it last looked, its newest posts and, if the look failed, why. */
export interface WatchTabView {
  query: string;
  checkedAt: number | null;
  error: string;
  posts: { id: string; handle: string; name: string; text: string; time: number | null }[];
}

/** The answer to a read; `refused` and `no_answer` as for actions. */
export type ReadAnswer =
  | { ok: true; what: 'library'; page: LibraryPage }
  | { ok: true; what: 'health'; accounts: AccountHealth[] }
  | { ok: true; what: 'watch'; tabs: WatchTabView[] }
  | { ok: true; what: 'settings'; settings: XomoniSettings }
  | { ok: true; what: 'cleanup'; estimate: CleanupEstimate }
  | { ok: true; what: 'replies'; page: RepliesPage }
  | { ok: true; what: 'incoming'; page: IncomingPage }
  | { ok: true; what: 'vault'; vault: VaultSummary }
  | { ok: false; reason: ActionRefusal };

/** How fresh one of X's files in the vault is (#425): never imported, fresh, due for a new copy, or overdue. */
export type VaultFreshness = 'never' | 'fresh' | 'due' | 'overdue';

/** Every `VaultFreshness`, for the parser. */
export const VAULT_FRESHNESS: readonly VaultFreshness[] = ['never', 'fresh', 'due', 'overdue'];

/** The vault's sources a summary names: X's archive, its analytics of posts and of days, and the *Under the hood* file. */
export type VaultSummarySource = 'x-archive' | 'x-analytics-posts' | 'x-analytics-days' | 'x-under-the-hood';

/** Every `VaultSummarySource`, in the order the website shows them. */
export const VAULT_SUMMARY_SOURCES: readonly VaultSummarySource[] = [
  'x-archive',
  'x-analytics-posts',
  'x-analytics-days',
  'x-under-the-hood',
];

/** One source of the vault, as counts and dates only. */
export interface VaultSourceSummary {
  source: VaultSummarySource;
  /** When the newest copy is from (epoch ms), or null when there is none. */
  lastAt: number | null;
  freshness: VaultFreshness;
  /** Rows the vault holds from it. */
  rows: number;
}

/**
 * What the website may read of the vault (#426, ADR-0028 as amended): each source's date, freshness and row count, the
 * day X made the newest archive, how many imports the ledger holds, and how many reading groups are on (none in R1).
 * No text, no file name, no id of X's.
 */
export interface VaultSummary {
  handle: string;
  sources: VaultSourceSummary[];
  archiveGeneratedAt: number | null;
  imports: number;
  captureGroupsOn: number;
}

/** The most rows or imports a vault summary may count: far beyond any real vault. */
const MAX_VAULT_COUNT = 1e12;

const vaultCount = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_VAULT_COUNT ? value : null;

/** `raw` as a vault summary, or null unless it has exactly that shape: no extra key, every count a whole number. */
export function parseVaultSummary(raw: unknown): VaultSummary | null {
  const v = record(raw);
  if (!v || !onlyKeys(v, ['handle', 'sources', 'archiveGeneratedAt', 'imports', 'captureGroupsOn'])) return null;
  const handle = matching(v.handle, HANDLE_TEXT);
  const archiveGeneratedAt = v.archiveGeneratedAt === null ? null : (time(v.archiveGeneratedAt) ?? undefined);
  const imports = vaultCount(v.imports);
  const groups = vaultCount(v.captureGroupsOn);
  if (handle === null || archiveGeneratedAt === undefined || imports === null || groups === null) return null;
  if (!Array.isArray(v.sources) || v.sources.length > VAULT_SUMMARY_SOURCES.length) return null;
  const sources: VaultSourceSummary[] = [];
  for (const entry of v.sources as unknown[]) {
    const s = record(entry);
    if (!s || !onlyKeys(s, ['source', 'lastAt', 'freshness', 'rows'])) return null;
    const source = VAULT_SUMMARY_SOURCES.find((x) => x === s.source);
    const freshness = VAULT_FRESHNESS.find((x) => x === s.freshness);
    const lastAt = s.lastAt === null ? null : (time(s.lastAt) ?? undefined);
    const rows = vaultCount(s.rows);
    if (!source || !freshness || lastAt === undefined || rows === null) return null;
    if (sources.some((x) => x.source === source)) return null;
    sources.push({ source, lastAt, freshness, rows });
  }
  return { handle, sources, archiveGeneratedAt, imports, captureGroupsOn: groups };
}

const X_ID = /^\d{1,25}$/;
const HANDLE_TEXT = /^[A-Za-z0-9_]{0,15}$/;

function text(value: unknown, max = MAX_READ_TEXT): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function time(value: unknown): number | null | undefined {
  if (value === null) return null;
  return epoch(value) ?? undefined;
}

function parseItem(raw: unknown): LibraryItem | null {
  const v = record(raw);
  const kind = LIBRARY_KINDS.find((k) => k === v?.kind);
  const id = matching(v?.id, X_ID);
  const author = matching(v?.author, HANDLE_TEXT);
  const body = text(v?.text);
  const createdAt = epoch(v?.createdAt);
  const [likes, reposts, replies] = [count(v?.likes), count(v?.reposts), count(v?.replies)];
  if (!kind || !id || author === null || body === null || createdAt === null) return null;
  if (likes === null || reposts === null || replies === null || typeof v?.removed !== 'boolean') return null;
  return { kind, id, author, text: body, createdAt, likes, reposts, replies, removed: v.removed };
}

function parseLibrary(raw: unknown): LibraryPage | null {
  const v = record(raw);
  const handle = matching(v?.handle, HANDLE_TEXT);
  const countsRaw = record(v?.counts);
  const matchingCount = count(v?.matching);
  // Null on the last page; anything that isn't a count is malformed.
  const next = v?.next === null ? null : (count(v?.next) ?? undefined);
  if (handle === null || !countsRaw || matchingCount === null || next === undefined || !Array.isArray(v?.items))
    return null;
  const counts = {} as LibraryPage['counts'];
  for (const k of LIBRARY_KINDS) {
    const c = record(countsRaw[k]);
    const present = count(c?.present);
    const removed = count(c?.removed);
    if (present === null || removed === null) return null;
    counts[k] = { present, removed };
  }
  const items = (v.items as unknown[]).slice(0, READ_PAGE).map(parseItem);
  if (items.some((i) => i === null)) return null;
  return { handle, counts, matching: matchingCount, items: items as LibraryItem[], next };
}

function parseReply(raw: unknown): ReplyItem | null {
  const v = record(raw);
  const id = matching(v?.id, X_ID);
  const replyTo = matching(v?.replyTo, HANDLE_TEXT);
  const body = text(v?.text);
  const createdAt = epoch(v?.createdAt);
  const [likes, reposts, replies] = [count(v?.likes), count(v?.reposts), count(v?.replies)];
  if (!id || replyTo === null || body === null || createdAt === null) return null;
  if (likes === null || reposts === null || replies === null || typeof v?.thread !== 'boolean') return null;
  return { id, replyTo, text: body, createdAt, likes, reposts, replies, thread: v.thread };
}

function parseReplies(raw: unknown): RepliesPage | null {
  const v = record(raw);
  const handle = matching(v?.handle, HANDLE_TEXT);
  const total = count(v?.total);
  const matchingCount = count(v?.matching);
  const next = v?.next === null ? null : (count(v?.next) ?? undefined);
  if (handle === null || total === null || matchingCount === null || next === undefined) return null;
  const people = parsePeople(v?.people);
  if (!people || !Array.isArray(v?.items)) return null;
  const items = (v.items as unknown[]).slice(0, READ_PAGE).map(parseReply);
  if (items.some((i) => i === null)) return null;
  return { handle, total, matching: matchingCount, items: items as ReplyItem[], next, people };
}

function parsePeople(raw: unknown): RepliedTo[] | null {
  if (!Array.isArray(raw)) return null;
  const people: RepliedTo[] = [];
  for (const entry of (raw as unknown[]).slice(0, MAX_REPLIED_TO)) {
    const person = record(entry);
    const who = matching(person?.handle, HANDLE_TEXT);
    const replies = count(person?.replies);
    if (!who || replies === null) return null;
    people.push({ handle: who, replies });
  }
  return people;
}

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

function parseIncomingReply(raw: unknown): IncomingReply | null {
  const v = record(raw);
  const id = matching(v?.id, X_ID);
  const author = matching(v?.author, HANDLE_TEXT);
  const body = text(v?.text);
  const createdAt = epoch(v?.createdAt);
  const toId = matching(v?.toId, X_ID);
  if (!id || !author || body === null || createdAt === null || !toId) return null;
  return { id, author, text: body, createdAt, toId };
}

function parseIncoming(raw: unknown): IncomingPage | null {
  const v = record(raw);
  const handle = matching(v?.handle, HANDLE_TEXT);
  const total = count(v?.total);
  const since = time(v?.since);
  const matchingCount = count(v?.matching);
  const next = v?.next === null ? null : (count(v?.next) ?? undefined);
  const people = parsePeople(v?.people);
  if (handle === null || total === null || since === undefined || matchingCount === null || next === undefined)
    return null;
  if (!people || !Array.isArray(v?.items) || !Array.isArray(v.perDay)) return null;
  const perDay: IncomingPage['perDay'] = [];
  for (const entry of (v.perDay as unknown[]).slice(0, INCOMING_DAYS + 1)) {
    const d = record(entry);
    const day = matching(d?.day, DAY_TEXT);
    const replies = count(d?.replies);
    if (!day || replies === null) return null;
    perDay.push({ day, replies });
  }
  const items = (v.items as unknown[]).slice(0, READ_PAGE).map(parseIncomingReply);
  if (items.some((i) => i === null)) return null;
  return { handle, total, since, perDay, people, matching: matchingCount, items: items as IncomingReply[], next };
}

function parseHealth(raw: unknown): AccountHealth | null {
  const v = record(raw);
  const handle = matching(v?.handle, HANDLE_TEXT);
  const level = typeof v?.level === 'number' && [0, 1, 2, 3, 4].includes(v.level) ? v.level : null;
  const reason = text(v?.reason, 300);
  const pace = typeof v?.pace === 'number' && [1, 0.5, 0.25].includes(v.pace) ? v.pace : null;
  const reducedUntil = time(v?.reducedUntil);
  const resumeAt = time(v?.resumeAt);
  if (handle === null || level === null || reason === null || pace === null) return null;
  if (reducedUntil === undefined || resumeAt === undefined || typeof v?.fullStop !== 'boolean') return null;
  return { handle, level, reason, pace, reducedUntil, resumeAt, fullStop: v.fullStop };
}

function parseTab(raw: unknown): WatchTabView | null {
  const v = record(raw);
  const query = text(v?.query, MAX_READ_QUERY);
  const checkedAt = time(v?.checkedAt);
  const error = text(v?.error, 300);
  if (query === null || checkedAt === undefined || error === null || !Array.isArray(v?.posts)) return null;
  const posts: WatchTabView['posts'] = [];
  for (const p of (v.posts as unknown[]).slice(0, READ_PAGE)) {
    const post = record(p);
    const id = matching(post?.id, X_ID);
    const handle = matching(post?.handle, HANDLE_TEXT);
    const name = text(post?.name, 100);
    const body = text(post?.text);
    const at = time(post?.time);
    if (!id || handle === null || name === null || body === null || at === undefined) return null;
    posts.push({ id, handle, name, text: body, time: at });
  }
  return { query, checkedAt, error, posts };
}

/** `raw` as the answer to a read of `what`: anything unexpected is `refused`, nothing at all `no_answer`. */
export function parseReadAnswer(raw: unknown, what: ReadWhat): ReadAnswer {
  if (raw === undefined || raw === null) return { ok: false, reason: 'no_answer' };
  const answer = record(raw);
  if (answer?.ok === true && answer.what === what) {
    if (what === 'library') {
      const page = parseLibrary(answer.page);
      if (page) return { ok: true, what, page };
    } else if (what === 'health' && Array.isArray(answer.accounts)) {
      const accounts = (answer.accounts as unknown[]).slice(0, 50).map(parseHealth);
      if (!accounts.some((a) => a === null)) return { ok: true, what, accounts: accounts as AccountHealth[] };
    } else if (what === 'watch' && Array.isArray(answer.tabs)) {
      const tabs = (answer.tabs as unknown[]).slice(0, 10).map(parseTab);
      if (!tabs.some((t) => t === null)) return { ok: true, what, tabs: tabs as WatchTabView[] };
    } else if (what === 'settings') {
      const settings = parseSettings(answer.settings);
      if (settings) return { ok: true, what, settings };
    } else if (what === 'cleanup') {
      const estimate = parseEstimate(answer.estimate);
      if (estimate) return { ok: true, what, estimate };
    } else if (what === 'replies') {
      const page = parseReplies(answer.page);
      if (page) return { ok: true, what, page };
    } else if (what === 'incoming') {
      const page = parseIncoming(answer.page);
      if (page) return { ok: true, what, page };
    } else if (what === 'vault') {
      const vault = parseVaultSummary(answer.vault);
      if (vault) return { ok: true, what, vault };
    }
  }
  const reason = ACTION_REFUSALS.find((r) => r === answer?.reason);
  return { ok: false, reason: reason ?? 'refused' };
}

// ── Settings (ADR-0029, #234) ────────────────────────────────────────────────────────────────────
// The website changes a fixed few of Xomoni's settings in the same browser. Xomoni checks and clamps every value
// with its own rules, so nothing can be set faster than Careful or above the one-fifth ceilings (ADR-0012).

/** Asks the extension to change some of its settings (ADR-0029). */
export const SETTINGS = 'xomoni-settings';

/** The actions Xomoni paces, in its own order. */
export type PaceAction = 'delete' | 'unretweet' | 'unlike' | 'relike' | 'read';

/** Every `PaceAction`. */
export const PACE_ACTIONS: readonly PaceAction[] = ['delete', 'unretweet', 'unlike', 'relike', 'read'];

/** The most Watch searches an account has (ADR-0021). */
export const MAX_WATCH_SEARCHES = 5;

/** Local hours from `start` up to `end` (0–23); the same hour for both means all day, as in Xomoni. */
export interface ActiveHours {
  enabled: boolean;
  start: number;
  end: number;
}

/** Xomoni's settings as the website shows them. */
export interface XomoniSettings {
  /** `careful` runs at one fifth of X's published limits; `custom` is slower, and set in Xomoni. */
  preset: 'careful' | 'custom';
  /** Each action's caps as Xomoni applies them. */
  pace: Record<PaceAction, { perHour: number; perDay: number }>;
  activeHours: ActiveHours;
  notifications: boolean;
  whileAway: boolean;
  /** Unknown failures in a row that pause a job: 1 to 3. */
  maxFailures: number;
  /** The active X account, whose Watch searches `watch` holds; empty when Xomoni knows none yet. */
  handle: string;
  /** The active account's Watch tabs in order; an empty string is a tab with no search yet. */
  watch: string[];
}

/** What the website may change (ADR-0029); at least one of them. */
export interface SettingsChange {
  /** Back to Careful: custom pacing is set in Xomoni. */
  preset?: 'careful';
  activeHours?: ActiveHours;
  notifications?: boolean;
  whileAway?: boolean;
  maxFailures?: number;
  /** The active account's Watch tabs in order, at most `MAX_WATCH_SEARCHES`. */
  watch?: string[];
}

/** `{type: 'xomoni-settings', deviceId, change}`. */
export interface SettingsMessage {
  type: typeof SETTINGS;
  deviceId: string;
  change: SettingsChange;
}

/** The answer to `xomoni-settings`: the settings as Xomoni stored them, or why it refused. */
export type SettingsAnswer = { ok: true; settings: XomoniSettings } | { ok: false; reason: ActionRefusal };

const CHANGE_KEYS = ['preset', 'activeHours', 'notifications', 'whileAway', 'maxFailures', 'watch'] as const;

function hour(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : null;
}

function failures(value: unknown): number | null {
  return typeof value === 'number' && [1, 2, 3].includes(value) ? value : null;
}

function parseHours(raw: unknown): ActiveHours | null {
  const v = record(raw);
  if (!v || !onlyKeys(v, ['enabled', 'start', 'end']) || typeof v.enabled !== 'boolean') return null;
  const start = hour(v.start);
  const end = hour(v.end);
  return start === null || end === null ? null : { enabled: v.enabled, start, end };
}

function parseSearches(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_WATCH_SEARCHES) return null;
  const searches = raw as unknown[];
  return searches.every((q) => typeof q === 'string' && q.length <= MAX_READ_QUERY) ? (searches as string[]) : null;
}

/** `raw` as a settings message, or null unless it is exactly `SettingsMessage` with at least one valid change. */
export function parseSettingsMessage(raw: unknown): SettingsMessage | null {
  const value = record(raw);
  if (value?.type !== SETTINGS || !onlyKeys(value, ['type', 'deviceId', 'change'])) return null;
  const deviceId = matching(value.deviceId, DEVICE_ID);
  const c = record(value.change);
  if (!deviceId || !c || !onlyKeys(c, CHANGE_KEYS) || Object.keys(c).length === 0) return null;
  const change: SettingsChange = {};
  if ('preset' in c) {
    if (c.preset !== 'careful') return null;
    change.preset = 'careful';
  }
  if ('activeHours' in c) {
    const hours = parseHours(c.activeHours);
    if (!hours) return null;
    change.activeHours = hours;
  }
  for (const key of ['notifications', 'whileAway'] as const) {
    if (!(key in c)) continue;
    const on = c[key];
    if (typeof on !== 'boolean') return null;
    change[key] = on;
  }
  if ('maxFailures' in c) {
    const max = failures(c.maxFailures);
    if (max === null) return null;
    change.maxFailures = max;
  }
  if ('watch' in c) {
    const watch = parseSearches(c.watch);
    if (!watch) return null;
    change.watch = watch;
  }
  return { type: SETTINGS, deviceId, change };
}

function parseSettings(raw: unknown): XomoniSettings | null {
  const v = record(raw);
  const preset = v?.preset === 'careful' || v?.preset === 'custom' ? v.preset : null;
  const paceRaw = record(v?.pace);
  const activeHours = parseHours(v?.activeHours);
  const maxFailures = failures(v?.maxFailures);
  const handle = matching(v?.handle, HANDLE_TEXT);
  const watch = parseSearches(v?.watch);
  if (!preset || !paceRaw || !activeHours || maxFailures === null || handle === null || !watch) return null;
  if (typeof v?.notifications !== 'boolean' || typeof v.whileAway !== 'boolean') return null;
  const pace = {} as XomoniSettings['pace'];
  for (const action of PACE_ACTIONS) {
    const rule = record(paceRaw[action]);
    const perHour = count(rule?.perHour);
    const perDay = count(rule?.perDay);
    if (perHour === null || perDay === null) return null;
    pace[action] = { perHour, perDay };
  }
  return {
    preset,
    pace,
    activeHours,
    notifications: v.notifications,
    whileAway: v.whileAway,
    maxFailures,
    handle,
    watch,
  };
}

/** `raw` as the answer to `xomoni-settings`: anything unexpected is `refused`, nothing at all `no_answer`. */
export function parseSettingsAnswer(raw: unknown): SettingsAnswer {
  if (raw === undefined || raw === null) return { ok: false, reason: 'no_answer' };
  const answer = record(raw);
  if (answer?.ok === true) {
    const settings = parseSettings(answer.settings);
    if (settings) return { ok: true, settings };
  }
  const reason = ACTION_REFUSALS.find((r) => r === answer?.reason);
  return { ok: false, reason: reason ?? 'refused' };
}

// ── Cleanup plans (#235, ADR-0027) ───────────────────────────────────────────────────────────────
// The website asks the same questions as Xomoni's Cleanup page and hands the plan over. Xomoni opens its Cleanup page
// with the plan filled in; nothing starts until the person reviews it and confirms there.

/** Hands a cleanup plan to Xomoni, which opens its own Cleanup page with it. */
export const PLAN = 'xomoni-plan';

/** The most words a plan keeps posts by. */
export const MAX_PLAN_KEYWORDS = 20;

/** The longest such word or phrase. */
export const MAX_PLAN_KEYWORD = 50;

/** The most posts a plan can pick by id: the replies selected on xomoni.com (#256). */
export const MAX_PLAN_IDS = 500;

/** The earliest date a plan may name: X opened in 2006. */
const X_BEGAN = Date.UTC(2006, 0, 1);

/** What to remove and what to keep: the three questions of Xomoni's Cleanup page. Times are epoch ms. */
export interface CleanupPlan {
  /** What to remove. */
  target: LibraryKind;
  /** Only what is older than this. */
  before: number;
  /** And, if set, no older than this. */
  after: number | null;
  /** Keep posts and replies with at least this many likes. */
  keepMinLikes: number | null;
  /** Keep anything whose text holds one of these, lowercased. */
  keepKeywords: string[];
  /** Keep replies to your own posts (threads); replies only. */
  skipSelfReplies: boolean;
  /**
   * Only these posts, by X's id: the replies picked on xomoni.com (#256). Absent from a plan by date, so a Xomoni
   * older than the selection still takes those.
   */
  onlyIds?: string[];
}

/** What a plan would match in Xomoni's copy of the account, counted on the person's computer. */
export interface CleanupEstimate {
  /** The active X account; empty when Xomoni knows none. */
  handle: string;
  /** Items in Xomoni's copy the plan matches now. */
  matching: number;
  /** Whether the account's X archive was imported: without it, old items can be missed. */
  archive: boolean;
  /** The most of this action Xomoni does a day at the current pace. */
  perDay: number;
}

/** `{type: 'xomoni-plan', deviceId, plan}`. */
export interface PlanMessage {
  type: typeof PLAN;
  deviceId: string;
  plan: CleanupPlan;
}

function planTime(value: unknown, now: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= X_BEGAN && value <= now + 86_400_000
    ? value
    : null;
}

/** `raw` as a cleanup plan, or null unless every field has its shape and the dates make sense. */
export function parsePlan(raw: unknown, now = Date.now()): CleanupPlan | null {
  const v = record(raw);
  const keys = ['target', 'before', 'after', 'keepMinLikes', 'keepKeywords', 'skipSelfReplies'];
  if (!v || !onlyKeys(v, [...keys, 'onlyIds']) || keys.some((key) => !(key in v))) return null;
  const ids = v.onlyIds === undefined ? undefined : parseIds(v.onlyIds);
  if (ids === null) return null;
  const target = LIBRARY_KINDS.find((k) => k === v.target);
  const before = planTime(v.before, now);
  const after = v.after === null ? null : (planTime(v.after, now) ?? undefined);
  const likes = v.keepMinLikes === null ? null : (count(v.keepMinLikes) ?? undefined);
  const words = Array.isArray(v.keepKeywords) ? (v.keepKeywords as unknown[]) : null;
  if (!target || before === null || after === undefined || likes === undefined || !words) return null;
  if (after !== null && after >= before) return null;
  if (likes !== null && (likes < 1 || likes > 1_000_000)) return null;
  if (words.length > MAX_PLAN_KEYWORDS) return null;
  if (!words.every((w) => typeof w === 'string' && w.length > 0 && w.length <= MAX_PLAN_KEYWORD)) return null;
  if (typeof v.skipSelfReplies !== 'boolean') return null;
  return {
    target,
    before,
    after,
    keepMinLikes: likes,
    keepKeywords: words as string[],
    skipSelfReplies: v.skipSelfReplies,
    ...(ids && { onlyIds: ids }),
  };
}

/** A plan's picked ids: 1 to `MAX_PLAN_IDS` distinct post ids, or null. */
function parseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PLAN_IDS) return null;
  const ids = (raw as unknown[]).map((id) => matching(id, X_ID));
  if (ids.some((id) => id === null)) return null;
  return new Set(ids).size === ids.length ? (ids as string[]) : null;
}

/** `raw` as a plan message, or null unless it is exactly `PlanMessage`. */
export function parsePlanMessage(raw: unknown): PlanMessage | null {
  const value = record(raw);
  if (value?.type !== PLAN || !onlyKeys(value, ['type', 'deviceId', 'plan'])) return null;
  const deviceId = matching(value.deviceId, DEVICE_ID);
  const plan = parsePlan(value.plan);
  return deviceId && plan ? { type: PLAN, deviceId, plan } : null;
}

function parseEstimate(raw: unknown): CleanupEstimate | null {
  const v = record(raw);
  const handle = matching(v?.handle, HANDLE_TEXT);
  const matchingCount = count(v?.matching);
  const perDay = count(v?.perDay);
  if (handle === null || matchingCount === null || perDay === null || typeof v?.archive !== 'boolean') return null;
  return { handle, matching: matchingCount, archive: v.archive, perDay };
}
