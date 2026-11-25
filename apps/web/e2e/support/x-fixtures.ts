import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Request, Route } from '@playwright/test';

// x.com as the extension's browser tests see it (#342, ADR-0040): pages and GraphQL answers from the files in
// e2e/fixtures/x, never the real x.com. They are synthetic, shaped like X's where Xomoni reads them, and show made-up
// accounts. A test that needs X to answer otherwise (an error, a rate limit, another page) adds a route of its own
// after the harness's: Playwright tries the newest route first.

/** The folder of the X fixtures: pages, and `graphql/<Operation>.json` answers. */
export const X_FIXTURES = path.join(__dirname, '..', 'fixtures', 'x');

/**
 * How much of the fixture account's past X shows: `short`, its two posts (`graphql/<Operation>.json`); `long`, years of
 * posts, replies, a repost and likes, for an account X shows as Premium (`graphql/long-history/`, #345). An answer the
 * long history doesn't have comes from the short one.
 */
export type XHistory = 'short' | 'long';

/** The folder of each history's GraphQL answers, the first one looked in. */
const HISTORY_ANSWERS: Record<XHistory, string> = {
  short: path.join(X_FIXTURES, 'graphql'),
  long: path.join(X_FIXTURES, 'graphql', 'long-history'),
};

/** x.com's pages the fixtures have, by path. Any other path answers 404, as X does for a page that doesn't exist. */
const PAGES = new Map([
  ['/home', 'home.html'],
  ['/xomoni_fixture', 'profile.html'],
  ['/xomoni_fixture/with_replies', 'profile.html'],
  ['/xomoni_fixture/likes', 'profile.html'],
  // X's search, which Watch loads (#158, #345): its query is in the address.
  ['/search', 'search.html'],
]);

/** A GraphQL request of X's web app: `/i/api/graphql/<query id>/<Operation>`. */
const GRAPHQL = /^\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)$/;

/** The fields of the fixture's `UserByScreenName` answer the tests compare with what Xomoni shows. */
interface ProfileFixture {
  data: {
    user: {
      result: { rest_id: string; core: { screen_name: string; name: string }; legacy: { statuses_count: number } };
    };
  };
}

const profile = (
  JSON.parse(readFileSync(path.join(X_FIXTURES, 'graphql', 'UserByScreenName.json'), 'utf8')) as ProfileFixture
).data.user.result;

/** The made-up X account the fixtures show, as its profile answer says. No real person has this id or handle. */
export const FIXTURE_ACCOUNT = {
  id: profile.rest_id,
  handle: profile.core.screen_name,
  name: profile.core.name,
  posts: profile.legacy.statuses_count,
} as const;

/**
 * The other made-up X account the fixtures know (#345): the one whose posts the fixture account reposts, likes and
 * answers in the long history, and the one a test signs in as for "another account in the X window". No real person
 * has this id or handle.
 */
export const FRIEND_ACCOUNT = { id: '9000000000000000002', handle: 'fixture_friend', name: 'Fixture Friend' } as const;

/** What X's rate-limit headers say about an operation's 15-minute window. Null leaves that header out, as X may. */
export interface XRate {
  /** `x-rate-limit-limit`: requests X allows in the window. 150 unless given. */
  limit?: number | null;
  /** `x-rate-limit-remaining`: requests left in it. All but one unless given. */
  remaining?: number | null;
  /**
   * When the window resets, epoch ms; `x-rate-limit-reset` carries it in whole seconds. `resetIn` after each answer
   * unless given.
   */
  resetAt?: number | null;
  /** How long after each answer its window resets, in ms, when `resetAt` isn't given: 15 minutes unless given. */
  resetIn?: number;
  /**
   * How far X's clock is from this computer's, in ms, as X's `date` header shows it: negative when X's clock is behind,
   * which is this computer's clock running ahead (PLAYBOOK F7, #31). The same unless given.
   */
  xClockOffset?: number;
}

/**
 * X's rate-limit headers on a GraphQL answer, by default one request of a 15-minute window used, well within one fifth
 * (ADR-0012), and X's clock, which Xomoni compares with this computer's (PLAYBOOK F7).
 */
function xRateHeaders({ limit = 150, remaining, resetAt, resetIn = 15 * 60_000, xClockOffset = 0 }: XRate = {}): Record<
  string,
  string
> {
  const left = remaining === undefined && limit != null ? limit - 1 : remaining;
  const reset = resetAt === undefined ? Date.now() + resetIn : resetAt;
  return {
    ...(limit != null && { 'x-rate-limit-limit': String(limit) }),
    ...(left != null && { 'x-rate-limit-remaining': String(left) }),
    ...(reset != null && { 'x-rate-limit-reset': String(Math.floor(reset / 1000)) }),
    date: new Date(Date.now() + xClockOffset).toUTCString(),
  };
}

/** The fixture file of a GraphQL operation's answer in `history`, or null when the fixtures have none. */
function answerFile(op: string, history: XHistory): string | null {
  for (const folder of [HISTORY_ANSWERS[history], HISTORY_ANSWERS.short]) {
    const file = path.join(folder, `${op}.json`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** The history each browser context's x.com was served with (`serveX`), for the routes tests add later. */
const served = new WeakMap<BrowserContext, XHistory>();

/** The fixture that answers `request`: a page, a GraphQL answer, or X's 404. */
function answer(request: Request, history: XHistory): Parameters<Route['fulfill']>[0] {
  const url = new URL(request.url());
  const op = GRAPHQL.exec(url.pathname)?.[1];
  if (op) {
    const file = answerFile(op, history);
    if (!file) return { status: 404, contentType: 'application/json', body: '{"errors":[]}' };
    return { status: 200, contentType: 'application/json', headers: xRateHeaders(), path: file };
  }
  const page = PAGES.get(url.pathname);
  if (!page) return { status: 404, contentType: 'text/html', body: '<!doctype html><title>Page not found / X</title>' };
  return { status: 200, contentType: 'text/html; charset=utf-8', path: path.join(X_FIXTURES, page) };
}

/**
 * Serves x.com from the fixtures in `context`: every request to https://x.com, from any tab or window, the X window
 * Xomoni opens included, with the GraphQL answers of `history` (`short` unless given). With `signedIn`, X's `twid`
 * cookie names the fixture's account, as X sets it once someone signs in; Xomoni only reads it (ADR-0003). Without it,
 * x.com's pages show someone signed out.
 */
export async function serveX(
  context: BrowserContext,
  { signedIn, history = 'short' }: { signedIn: boolean; history?: XHistory },
): Promise<void> {
  served.set(context, history);
  await context.route(/^https:\/\/x\.com\//, (route) => route.fulfill(answer(route.request(), history)));
  if (signedIn) await setXSession(context, FIXTURE_ACCOUNT.id);
}

/**
 * Signs `context` in to X as the made-up account `accountId`, or out of X with null (#345): X's `twid` cookie, which
 * every x.com tab shares, as X sets it when someone signs in or out. Pages already open see it on their next look;
 * Xomoni only reads it (ADR-0003).
 */
export async function setXSession(context: BrowserContext, accountId: string | null): Promise<void> {
  await context.clearCookies({ name: 'twid' });
  if (accountId == null) return;
  await context.addCookies([
    {
      name: 'twid',
      value: encodeURIComponent(`u=${accountId}`),
      domain: '.x.com',
      path: '/',
      secure: true,
      sameSite: 'None',
    },
  ]);
}

/** Answers x.com's page at `pathname` with the fixture page `file` from now on, such as X's /home with a notice (#345). */
export async function servePage(context: BrowserContext, pathname: string, file: string): Promise<void> {
  await context.route(
    (url) => url.host === 'x.com' && url.pathname === pathname,
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', path: path.join(X_FIXTURES, file) }),
  );
}

/**
 * Answers x.com's page at `pathname` with the fixture page `file` from now on, on which X draws `notice` at the top of
 * the primary column together with the page's posts, as a notice that comes with X's answer would be (#375). The rest of
 * the page is the fixture's own.
 */
export async function servePageWithNotice(
  context: BrowserContext,
  pathname: string,
  file: string,
  notice: string,
): Promise<void> {
  const drawNotice = `<script>
      new MutationObserver((_, observer) => {
        if (!document.querySelector('article[data-testid="tweet"]')) return;
        observer.disconnect();
        const alert = document.createElement('div');
        alert.setAttribute('role', 'alert');
        alert.textContent = ${JSON.stringify(notice)};
        document.querySelector('[data-testid="primaryColumn"]').prepend(alert);
      }).observe(document.body, { childList: true, subtree: true });
    </script>
  </body>`;
  const body = readFileSync(path.join(X_FIXTURES, file), 'utf8').replace('</body>', drawNotice);
  await context.route(
    (url) => url.host === 'x.com' && url.pathname === pathname,
    (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }),
  );
}

/**
 * Makes X answer GraphQL operation `op` `ms` milliseconds late from now on (#375), with its usual answer from the history
 * `context` is served with, as X does on a slow day: its page then shows the posts, and whatever comes with them, a
 * moment after the page itself has loaded.
 */
export async function answerLate(context: BrowserContext, op: string, ms: number): Promise<void> {
  const file = answerFile(op, served.get(context) ?? 'short');
  if (!file) throw new Error(`The fixtures have no answer for ${op}`);
  await context.route(
    (url) => url.host === 'x.com' && GRAPHQL.exec(url.pathname)?.[1] === op,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: xRateHeaders(), path: file });
    },
  );
}

/** X's answers to a request it refuses: its rate limit reached (429, X's error 88), or X over capacity (503, error 130). */
const REFUSED = {
  429: '{"errors":[{"code":88,"message":"Rate limit exceeded."}]}',
  503: '{"errors":[{"code":130,"message":"Over capacity"}]}',
} as const;

/**
 * Makes X answer GraphQL operation `op` with `rate` in its headers from now on (#345): a 429, X's rate limit reached,
 * with `status: 429`; a 503, X over capacity, with `status: 503`; else X's usual answer, from the history `context` is
 * served with. The person's own browsing and Xomoni's page loads both see it, as on X.
 */
export async function answerWithRate(
  context: BrowserContext,
  op: string,
  { status = 200, ...rate }: XRate & { status?: 200 | 429 | 503 },
): Promise<void> {
  const history = served.get(context) ?? 'short';
  await context.route(
    (url) => url.host === 'x.com' && GRAPHQL.exec(url.pathname)?.[1] === op,
    (route) => {
      const headers = xRateHeaders(status === 429 ? { remaining: 0, ...rate } : rate);
      if (status !== 200)
        return route.fulfill({ status, contentType: 'application/json', headers, body: REFUSED[status] });
      const file = answerFile(op, history);
      if (!file) throw new Error(`The fixtures have no answer for ${op}`);
      return route.fulfill({ status, contentType: 'application/json', headers, path: file });
    },
  );
}

/** Sets, on every post in `node`, an answer of X's, the `legacy` fields `patches` gives for its `legacy.id_str`. */
function patchPosts(node: unknown, patches: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
  if (Array.isArray(node)) {
    for (const child of node) patchPosts(child, patches);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const { legacy } = node as { legacy?: { id_str?: unknown } };
  const id = legacy?.id_str;
  if (legacy && typeof id === 'string' && Object.hasOwn(patches, id)) Object.assign(legacy, patches[id]);
  for (const child of Object.values(node)) patchPosts(child, patches);
}

/**
 * Makes X answer GraphQL operation `op` from now on with its usual answer, from the history `context` is served with,
 * once `patches` are applied to the posts it names by id. The person's own browsing and Xomoni's page loads both see
 * it, as on X.
 */
async function answerWithPatches(
  context: BrowserContext,
  op: string,
  patches: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Promise<void> {
  const file = answerFile(op, served.get(context) ?? 'short');
  if (!file) throw new Error(`The fixtures have no answer for ${op}`);
  const answer = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  patchPosts(answer, patches);
  const body = JSON.stringify(answer);
  await context.route(
    (url) => url.host === 'x.com' && GRAPHQL.exec(url.pathname)?.[1] === op,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: xRateHeaders(), body }),
  );
}

/** `values` by post id, each as the `legacy` field `name` of that post. */
const fieldOf = (name: string, values: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { [name]: value }]));

/**
 * Makes X answer GraphQL operation `op` with other like counts from now on (#367): `likes` maps a post's id to the
 * count X shows for it, as X does once people have liked it since, or taken their like back. The rest of the answer is
 * X's usual one, from the history `context` is served with. The person's own browsing and Xomoni's page loads both see
 * it, as on X.
 */
export async function answerWithLikes(
  context: BrowserContext,
  op: string,
  likes: Readonly<Record<string, number>>,
): Promise<void> {
  await answerWithPatches(context, op, fieldOf('favorite_count', likes));
}

/**
 * Makes X answer GraphQL operation `op` with other post text from now on (#370): `texts` maps a post's id to its
 * `full_text` as X sends it, HTML-escaped (`R&amp;D &lt;3`), while X's page shows it decoded (`R&D <3`, as
 * profile.html does). The rest of the answer is X's usual one, from the history `context` is served with.
 */
export async function answerWithText(
  context: BrowserContext,
  op: string,
  texts: Readonly<Record<string, string>>,
): Promise<void> {
  await answerWithPatches(context, op, fieldOf('full_text', texts));
}

/** A reply someone wrote to one of the fixture account's posts, as a test has X show it (#256). */
export interface ReplyToAccount {
  /** The reply's id, made up, in the fixtures' range. */
  id: string;
  /** Its text, as X sends it. */
  text: string;
  /** When it was posted, epoch ms. */
  createdAt: number;
  /** The id of the fixture account's post it answers. */
  to: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `ms` as X's `created_at` writes a time, in UTC: `Mon Nov 02 12:00:00 +0000 2020`. */
function xTime(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  const clock = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  return `${WEEKDAYS[d.getUTCDay()] ?? ''} ${MONTHS[d.getUTCMonth()] ?? ''} ${two(d.getUTCDate())} ${clock} +0000 ${String(d.getUTCFullYear())}`;
}

/** The first `entries` array in an answer: a timeline's posts. */
function entriesOf(node: unknown): unknown[] | null {
  if (node === null || typeof node !== 'object') return null;
  const { entries } = node as { entries?: unknown };
  if (Array.isArray(entries)) return entries as unknown[];
  for (const child of Object.values(node)) {
    const found = entriesOf(child);
    if (found) return found;
  }
  return null;
}

/** One of the fixture account's own posts, as a test has X show it with its views (#429). */
export interface OwnPost {
  /** The post's id, made up, in the fixtures' range. */
  id: string;
  /** Its text, as X sends it. */
  text: string;
  /** When it was posted, epoch ms. */
  createdAt: number;
  /** The views X shows for it (`views.count`, a string of digits); left out when undefined, as X does on some posts. */
  views?: number | string;
  /** Links in it that lead out of X, and photos it carries. */
  links?: readonly string[];
  photos?: number;
  /** The post it answers, when it is a reply to someone else. */
  replyTo?: string;
  /** Written by `FRIEND_ACCOUNT` instead, as X shows someone else's post on the profile (a conversation's start). */
  byFriend?: boolean;
}

/**
 * Makes X answer GraphQL operation `op` from now on with its usual answer and, first, `posts`: the fixture account's
 * own (or `FRIEND_ACCOUNT`'s, with `byFriend`), each with its views, links and photos, as X shows them on the account's
 * profile (#429); `lateMs` after the request when given, as X does when it is slow. The rest of the answer is X's usual
 * one, from the history `context` is served with.
 */
export async function answerWithOwnPosts(
  context: BrowserContext,
  op: string,
  posts: readonly OwnPost[],
  { lateMs = 0 }: { lateMs?: number } = {},
): Promise<void> {
  const file = answerFile(op, served.get(context) ?? 'short');
  if (!file) throw new Error(`The fixtures have no answer for ${op}`);
  const answer = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const entries = entriesOf(answer);
  if (!entries) throw new Error(`The fixtures' answer for ${op} has no timeline`);
  entries.unshift(
    ...posts.map((post) => {
      const author = post.byFriend ? FRIEND_ACCOUNT : FIXTURE_ACCOUNT;
      const photos = Array.from({ length: post.photos ?? 0 }, (_, i) => ({
        type: 'photo',
        url: `https://t.co/p${String(i)}`,
        expanded_url: `https://x.com/${author.handle}/status/${post.id}/photo/${String(i + 1)}`,
        media_url_https: `https://pbs.twimg.com/media/fixture${String(i)}.jpg`,
      }));
      return {
        entryId: `tweet-${post.id}`,
        sortIndex: post.id,
        content: {
          itemContent: {
            tweet_results: {
              result: {
                __typename: 'Tweet',
                rest_id: post.id,
                core: {
                  user_results: {
                    result: {
                      rest_id: author.id,
                      core: { screen_name: author.handle, name: author.name },
                    },
                  },
                },
                ...(post.views !== undefined && { views: { count: String(post.views), state: 'EnabledWithCount' } }),
                legacy: {
                  id_str: post.id,
                  user_id_str: author.id,
                  created_at: xTime(post.createdAt),
                  full_text: post.text,
                  favorite_count: 0,
                  retweet_count: 0,
                  reply_count: 0,
                  favorited: false,
                  retweeted: false,
                  entities: {
                    urls: (post.links ?? []).map((link) => ({ url: 'https://t.co/l', expanded_url: link })),
                    ...(photos.length > 0 && { media: photos.slice(0, 1) }),
                  },
                  ...(photos.length > 0 && { extended_entities: { media: photos } }),
                  ...(post.replyTo && {
                    in_reply_to_status_id_str: post.replyTo,
                    in_reply_to_user_id_str: FRIEND_ACCOUNT.id,
                    in_reply_to_screen_name: FRIEND_ACCOUNT.handle,
                  }),
                },
              },
            },
          },
        },
      };
    }),
  );
  const body = JSON.stringify(answer);
  await context.route(
    (url) => url.host === 'x.com' && GRAPHQL.exec(url.pathname)?.[1] === op,
    async (route) => {
      if (lateMs) await new Promise((resolve) => setTimeout(resolve, lateMs));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: xRateHeaders(), body });
    },
  );
}

/**
 * Makes X answer GraphQL operation `op` from now on with its usual answer and, first, `replies`: each written by
 * `FRIEND_ACCOUNT` to a post of the fixture account, as X shows the replies people wrote in a conversation (#256).
 * Xomoni keeps such replies for *Replies to you* (ADR-0030). The rest of the answer is X's usual one, from the history
 * `context` is served with.
 */
export async function answerWithRepliesToAccount(
  context: BrowserContext,
  op: string,
  replies: readonly ReplyToAccount[],
): Promise<void> {
  const file = answerFile(op, served.get(context) ?? 'short');
  if (!file) throw new Error(`The fixtures have no answer for ${op}`);
  const answer = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const entries = entriesOf(answer);
  if (!entries) throw new Error(`The fixtures' answer for ${op} has no timeline`);
  entries.unshift(
    ...replies.map((reply) => ({
      entryId: `tweet-${reply.id}`,
      sortIndex: reply.id,
      content: {
        itemContent: {
          tweet_results: {
            result: {
              __typename: 'Tweet',
              rest_id: reply.id,
              core: {
                user_results: {
                  result: {
                    rest_id: FRIEND_ACCOUNT.id,
                    core: { screen_name: FRIEND_ACCOUNT.handle, name: FRIEND_ACCOUNT.name },
                  },
                },
              },
              legacy: {
                id_str: reply.id,
                user_id_str: FRIEND_ACCOUNT.id,
                created_at: xTime(reply.createdAt),
                full_text: reply.text,
                favorite_count: 0,
                retweet_count: 0,
                reply_count: 0,
                favorited: false,
                retweeted: false,
                in_reply_to_status_id_str: reply.to,
                in_reply_to_user_id_str: FIXTURE_ACCOUNT.id,
                in_reply_to_screen_name: FIXTURE_ACCOUNT.handle,
              },
            },
          },
        },
      },
    })),
  );
  const body = JSON.stringify(answer);
  await context.route(
    (url) => url.host === 'x.com' && GRAPHQL.exec(url.pathname)?.[1] === op,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: xRateHeaders(), body }),
  );
}
