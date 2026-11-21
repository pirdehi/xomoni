import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Request, Route } from '@playwright/test';

// x.com as the extension's browser tests see it (#342, ADR-0040): pages and GraphQL answers from the files in
// e2e/fixtures/x, never the real x.com. They are synthetic, shaped like X's where Xomoni reads them, and show one
// made-up account. A test that needs X to answer otherwise (an error, a rate limit, another page) adds a route of its
// own after the harness's: Playwright tries the newest route first.

/** The folder of the X fixtures: pages, and `graphql/<Operation>.json` answers. */
export const X_FIXTURES = path.join(__dirname, '..', 'fixtures', 'x');

/** x.com's pages the fixtures have, by path. Any other path answers 404, as X does for a page that doesn't exist. */
const PAGES = new Map([
  ['/home', 'home.html'],
  ['/xomoni_fixture', 'profile.html'],
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
 * X's rate-limit headers on a GraphQL answer: one request of a 15-minute window used, well within one fifth (ADR-0012),
 * and X's clock, which Xomoni compares with this computer's (PLAYBOOK F7).
 */
function rateHeaders(): Record<string, string> {
  return {
    'x-rate-limit-limit': '150',
    'x-rate-limit-remaining': '149',
    'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 15 * 60),
    date: new Date().toUTCString(),
  };
}

/** The fixture that answers `request`: a page, a GraphQL answer, or X's 404. */
function answer(request: Request): Parameters<Route['fulfill']>[0] {
  const url = new URL(request.url());
  const op = GRAPHQL.exec(url.pathname)?.[1];
  if (op) {
    const file = path.join(X_FIXTURES, 'graphql', `${op}.json`);
    if (!existsSync(file)) return { status: 404, contentType: 'application/json', body: '{"errors":[]}' };
    return { status: 200, contentType: 'application/json', headers: rateHeaders(), path: file };
  }
  const page = PAGES.get(url.pathname);
  if (!page) return { status: 404, contentType: 'text/html', body: '<!doctype html><title>Page not found / X</title>' };
  return { status: 200, contentType: 'text/html; charset=utf-8', path: path.join(X_FIXTURES, page) };
}

/**
 * Serves x.com from the fixtures in `context`: every request to https://x.com, from any tab or window, the X window
 * Xomoni opens included. With `signedIn`, X's `twid` cookie names the fixture's account, as X sets it once someone
 * signs in; Xomoni only reads it (ADR-0003). Without it, x.com's pages show someone signed out.
 */
export async function serveX(context: BrowserContext, { signedIn }: { signedIn: boolean }): Promise<void> {
  await context.route(/^https:\/\/x\.com\//, (route) => route.fulfill(answer(route.request())));
  if (signedIn) {
    await context.addCookies([
      {
        name: 'twid',
        value: encodeURIComponent(`u=${FIXTURE_ACCOUNT.id}`),
        domain: '.x.com',
        path: '/',
        secure: true,
        sameSite: 'None',
      },
    ]);
  }
}
