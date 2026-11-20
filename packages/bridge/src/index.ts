// The messages xomoni.com and the Xomoni extension exchange inside one browser, through `externally_connectable`
// (ADR-0024, ADR-0025). One contract for both apps: the website builds messages and reads answers with it, and the
// extension's service worker parses messages with it. Every parser is strict: the exact keys and shapes, anything else
// is null (or, for an answer, a refusal). Nothing here carries X content (ADR-0004). An action can ask the extension to
// stop or to open its own page; it can never start, resume or approve work on X, which only the person does in
// Xomoni (ADR-0027).

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

/** Chrome's id of an extension: 32 letters from a to p. */
export const EXTENSION_ID = /^[a-p]{32}$/;
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
export type XomoniPage = 'overview' | 'activity' | 'cleanup' | 'library' | 'watch' | 'settings';

/** Every `XomoniPage`, for the parser. */
export const XOMONI_PAGES: readonly XomoniPage[] = ['overview', 'activity', 'cleanup', 'library', 'watch', 'settings'];

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
  | SettingsMessage;

/** Whether `value` is shaped like an extension id. */
export function isExtensionId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_ID.test(value);
}

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

/** What the website may read: `settings` too, under ADR-0029. */
export type ReadWhat = 'library' | 'health' | 'watch' | 'settings';

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

/** `{type: 'xomoni-read', what, deviceId, …}`: the Library also takes a kind, a search and an offset. */
export type ReadMessage =
  | { type: typeof READ; what: 'library'; deviceId: string; kind: LibraryKind; query: string; offset: number }
  | { type: typeof READ; what: 'health' | 'watch' | 'settings'; deviceId: string };

/** `raw` as a read message, or null unless it is exactly one of `ReadMessage`'s shapes. */
export function parseReadMessage(raw: unknown): ReadMessage | null {
  const value = record(raw);
  if (value?.type !== READ) return null;
  const deviceId = matching(value.deviceId, DEVICE_ID);
  if (!deviceId) return null;
  if (value.what === 'health' || value.what === 'watch' || value.what === 'settings') {
    return onlyKeys(value, ['type', 'what', 'deviceId']) ? { type: READ, what: value.what, deviceId } : null;
  }
  if (value.what !== 'library' || !onlyKeys(value, ['type', 'what', 'deviceId', 'kind', 'query', 'offset']))
    return null;
  const kind = LIBRARY_KINDS.find((k) => k === value.kind);
  const query = typeof value.query === 'string' && value.query.length <= MAX_READ_QUERY ? value.query : null;
  const offset =
    typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0 && value.offset <= 1e6
      ? value.offset
      : null;
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
  | { ok: false; reason: ActionRefusal };

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
