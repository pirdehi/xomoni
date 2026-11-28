// The vault's data model (ADR-0043, #424): what X's official files tell Xomoni about the person's own account, kept in
// the extension's IndexedDB and never sent anywhere (ADR-0004). The closed lists here are the ones the database, the
// move file (ADR-0032) and the importer check against; a feature that adds a source, a metric or an event kind adds it
// here, in the same pull request as its parser.

/**
 * Where a vault row came from. The core reads X's archive and the analytics CSVs (`x-analytics-posts`, one row per
 * post; `x-analytics-days`, one row per day). `x-under-the-hood` is the monthly labels file (reach diagnosis, #428).
 * The `x-page-…` sources are named for a later release, under a decision of their own (ADR-0043, decision 1): nothing in
 * R1 writes them.
 */
export const VAULT_SOURCES = [
  'x-archive',
  'x-analytics-posts',
  'x-analytics-days',
  'x-under-the-hood',
  'x-page-bookmarks',
  'x-page-followers',
  'x-page-following',
] as const;

/** One of `VAULT_SOURCES`. */
export type VaultSource = (typeof VAULT_SOURCES)[number];

/**
 * How many rows one import read, merged and skipped (ADR-0043, decision 4). `parts` breaks `read` down by what the file
 * held, such as `{ tweets: 120, likes: 300 }` for an archive, for the Vault page's sources card.
 */
export interface ImportCounts {
  read: number;
  merged: number;
  skipped: number;
  parts?: Record<string, number>;
}

/**
 * One row of the import ledger, `vaultImports` (ADR-0043, decision 4): one per import, duplicates included. The ledger
 * and the fingerprints never leave the computer.
 */
export interface VaultImport {
  /** `<account id>:<source>:<importedAt>:<random>`; unique, and sorts by account then source. */
  id: string;
  accountId: string;
  source: VaultSource;
  /** The file's name as the person chose it, at most `MAX_FILE_NAME` characters. Never shown as HTML. */
  fileName: string;
  /** The file's size in bytes. */
  bytes: number;
  /** `zip:<hex>` (sizes and CRCs of a ZIP's directory) or `sha256:<hex>` (a text file); see `FINGERPRINT`. */
  fingerprint: string;
  /** Epoch ms. */
  importedAt: number;
  /** The first and last moment the file covers (epoch ms), when it says; for an archive, `coverTo` is the day X made it. */
  coverFrom: number | null;
  coverTo: number | null;
  counts: ImportCounts;
  /** The parser that read the file and its version, such as `x-archive@1`. */
  parser: string;
  /**
   * What went wrong or was left out, as short codes: `duplicate` (the same file was imported before, nothing was
   * written), `cancelled`, `unknown-field:<name>`, `skipped-row:<line>`. At most `MAX_PROBLEMS`.
   */
  problems: string[];
}

/**
 * The numbers X's analytics give for a post or a day. A file names only some of them, so each is optional: missing
 * means the file didn't say, not zero. X's counts only grow, so a merge keeps the highest seen (ADR-0043, decision 6).
 */
export const POST_METRICS = [
  'impressions',
  'engagements',
  'likes',
  'reposts',
  'replies',
  'quotes',
  'bookmarks',
  'shares',
  'profileVisits',
  'linkClicks',
  'detailExpands',
  'newFollows',
  'mediaViews',
  'videoViews',
] as const;

/** One of `POST_METRICS`. */
export type PostMetric = (typeof POST_METRICS)[number];

/** The numbers of one post, as far as a file says them. */
export type PostMetrics = Partial<Record<PostMetric, number>>;

/** The longest post text the vault keeps, only for a post the inventory doesn't hold (#425). */
export const ANALYTICS_TEXT = 1_000;

/**
 * One of the person's own posts as X's analytics export counts it (`analyticsPosts`), keyed by account and post id.
 */
export interface AnalyticsPost extends PostMetrics {
  /** `<account id>:<post id>`, as `analyticsPostKey` makes it. */
  key: string;
  accountId: string;
  postId: string;
  /** When the post was made (epoch ms). */
  createdAt: number;
  /** When X counted these numbers (epoch ms): the newest import's moment. */
  asOf: number;
  /** The post's text, cut to `ANALYTICS_TEXT`, only when the inventory doesn't hold the post. */
  text?: string;
}

/** The numbers X's analytics give for one day of the account. */
export const DAY_METRICS = [
  'impressions',
  'engagements',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'shares',
  'profileVisits',
  'newFollows',
  'unfollows',
  'postsCreated',
  'mediaViews',
  'videoViews',
] as const;

/** One of `DAY_METRICS`. */
export type DayMetric = (typeof DAY_METRICS)[number];

/** The numbers of one day, as far as a file says them. */
export type DayMetrics = Partial<Record<DayMetric, number>>;

/** One day of the account in X's analytics export (`analyticsDays`), keyed by account and day. */
export interface AnalyticsDay extends DayMetrics {
  accountId: string;
  /** `YYYY-MM-DD`, the day as X's file names it. */
  day: string;
  /** When X counted these numbers (epoch ms). For a day, the newest import wins (ADR-0043, decision 6). */
  asOf: number;
}

/**
 * What an entry of the account's timeline (`accountEvents`) records. A closed list: the move file refuses any other.
 * - `note`: the person's own entry.
 * - `premium_on`, `premium_off`: X Premium seen turned on or off on the profile, or dated by the person.
 * - `archive_requested`, `archive_imported`: X's archive asked for (ADR-0022) and imported into the vault.
 * - `x_label`: a label X applied in a month, from the *Under the hood* file (#428).
 * Risk-ladder events stay in their own table (`risk`) and join the timeline when it is read (`accountTimeline`).
 */
export const ACCOUNT_EVENT_KINDS = [
  'note',
  'premium_on',
  'premium_off',
  'archive_requested',
  'archive_imported',
  'x_label',
] as const;

/** One of `ACCOUNT_EVENT_KINDS`. */
export type AccountEventKind = (typeof ACCOUNT_EVENT_KINDS)[number];

/**
 * Who said that something happened: Xomoni itself, the person, X's profile page as the person opened it, or one of X's
 * files.
 */
export const ACCOUNT_EVENT_SOURCES = ['xomoni', 'person', 'profile', 'archive', 'analytics', 'under-the-hood'] as const;

/** One of `ACCOUNT_EVENT_SOURCES`. */
export type AccountEventSource = (typeof ACCOUNT_EVENT_SOURCES)[number];

/** The longest words an event keeps: Xomoni's own, or the person's note (ADR-0043, decision 8). */
export const EVENT_WORDS = 500;

/**
 * One entry of the account's timeline (`accountEvents`). `words` are Xomoni's own words or the person's note, never text
 * from an X page (#146); they are always shown as text, never as HTML.
 */
export interface AccountEvent {
  /** Auto-increment key. */
  seq?: number;
  accountId: string;
  kind: AccountEventKind;
  /** When it happened (epoch ms), which may be before it was recorded. */
  at: number;
  source: AccountEventSource;
  /** At most `EVENT_WORDS` characters. */
  words: string;
  /** What it refers to, such as the ledger row of an import; at most `MAX_REF` characters of `REF`. */
  ref?: string;
}

/** The longest file name the ledger keeps. */
export const MAX_FILE_NAME = 255;

/** The most problem codes one ledger row keeps, each at most `MAX_PROBLEM` characters. */
export const MAX_PROBLEMS = 50;

/** The longest problem code. */
export const MAX_PROBLEM = 200;

/** The longest `ref` of an event. */
export const MAX_REF = 200;

/** What a `ref` may hold: letters, digits and `:._@-`, so it can never carry markup or a post's text. */
export const REF = /^[A-Za-z0-9:._@-]{1,200}$/;

/** A file's fingerprint: `sha256:` or `zip:` and 16 to 64 hex digits. */
export const FINGERPRINT = /^(sha256|zip):[0-9a-f]{16,64}$/;

/** A day as X's files and the `daily` table name it. */
export const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** The largest number a vault count may hold: far beyond any real count, so a broken value is caught. */
export const MAX_COUNT = 1e12;
