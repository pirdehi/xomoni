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

/** Sets `favorite_count` on every post in `node`, an answer of X's, whose `legacy.id_str` `likes` names. */
function setLikes(node: unknown, likes: Readonly<Record<string, number>>): void {
  if (Array.isArray(node)) {
    for (const child of node) setLikes(child, likes);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const { legacy } = node as { legacy?: { id_str?: unknown; favorite_count?: number } };
  const id = legacy?.id_str;
  if (legacy && typeof id === 'string' && Object.hasOwn(likes, id)) legacy.favorite_count = likes[id];
  for (const child of Object.values(node)) setLikes(child, likes);
}

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
  const file = answerFile(op, served.get(context) ?? 'short');
  if (!file) throw new Error(`The fixtures have no answer for ${op}`);
  const answer = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  setLikes(answer, likes);
  const body = JSON.stringify(answer);
  await context.route(
    (url) => url.host === 'x.com' && GRAPHQL.exec(url.pathname)?.[1] === op,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: xRateHeaders(), body }),
  );
}
