import type { BrowserContext, Page } from '@playwright/test';

// xomoni.com and its database as Xomoni's browser tests see them (#345): played at the extension, as the website's
// tests play the extension at the page. Pages of https://xomoni.com are served from here, and send the extension the
// messages the website sends (`@xomoni/bridge`) through Chrome's own `externally_connectable`; the functions the
// extension calls on xomoni.com's Supabase project (`apps/extension/src/cloud/client.ts`, ADR-0018) answer from a small
// state kept here. Nothing reaches the network, and no real account takes part.

/** The Supabase project behind xomoni.com, as the extension's `cloud/config.ts` names it. */
export const CLOUD_URL = 'https://ueegjwwmuuxlxyibgokx.supabase.co';

/** The website's origin, the only one the extension's `externally_connectable` lets send. */
export const SITE = 'https://xomoni.com';

/** A made-up xomoni.com account, masked as `pair_device` names it to the extension. */
export const SITE_ACCOUNT = 'f•••@example.com';

/** The device id `pair_device` gives the browser the tests sign in. Made up. */
export const DEVICE_ID = '9e000000-0000-4000-8000-000000000001';

/** One call the extension made to xomoni.com: the function's name and what it sent. */
export interface CloudCall {
  fn: string;
  body: Record<string, unknown>;
}

/** xomoni.com as one test's browser sees it. */
export interface XomoniSite {
  /** Every call the extension made to xomoni.com's functions, in order. */
  calls: CloudCall[];
  /**
   * What `device_report` answers about the newest release (#151): the version, and whether it fixes a vulnerability.
   * Null says nothing about one, as a server older than the notice did.
   */
  release: { latest: string; security: boolean } | null;
  /**
   * The account's choice of daily numbers (ADR-0026), off unless a test turns it on, as the website or another browser
   * would: `device_report` answers it, `device_set_daily_stats` sets it, and `device_report_stats` takes days only
   * while it is on.
   */
  stats: boolean;
  /**
   * Signs Xomoni in from a page of xomoni.com, as the website does once its page is signed in (#232, ADR-0025): a
   * one-time code, sent as `xomoni-sign-in`. Returns the extension's answer.
   */
  signIn(extensionId: string): Promise<unknown>;
  /**
   * Sends `message` to Xomoni from `page`, a page of xomoni.com, as the website does (`@xomoni/bridge`), and returns its
   * answer: undefined when Xomoni gives none.
   */
  send(page: Page, extensionId: string, message: unknown): Promise<unknown>;
}

/** The one-time code xomoni.com's page hands the extension. Made up, in the shape of the website's codes. */
export const SITE_CODE = 'ABCDE-23456';
const CODE = SITE_CODE;

/** The token `pair_device` gives for the code: made up, never a real one. */
const TOKEN = 'e2e-device-token-not-a-secret';

/**
 * Serves xomoni.com and answers its functions in `context` from now on, with `release` as the newest release
 * `device_report` names (none unless given). Pages of xomoni.com are a bare page titled Xomoni: enough for the
 * extension's own pages and for sending its messages.
 */
export async function serveXomoniSite(
  context: BrowserContext,
  { release = null }: { release?: XomoniSite['release'] } = {},
): Promise<XomoniSite> {
  const site: XomoniSite = {
    calls: [],
    release,
    stats: false,
    signIn: async (extensionId) => {
      const page = await context.newPage();
      await page.goto(`${SITE}/dashboard`);
      const answer = await site.send(page, extensionId, { type: 'xomoni-sign-in', code: CODE });
      await page.close();
      return answer;
    },
    send: (page, extensionId, message) =>
      page.evaluate(
        ({ id, message }) => {
          // Chrome's own channel, there on xomoni.com because Xomoni lists it in `externally_connectable`.
          const { chrome } = window as unknown as {
            chrome: { runtime: { sendMessage(id: string, message: unknown): Promise<unknown> } };
          };
          return chrome.runtime.sendMessage(id, message);
        },
        { id: extensionId, message },
      ),
  };
  let paired = false;

  await context.route(
    (url) => url.host === 'xomoni.com',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html lang="en"><title>Xomoni</title><h1>Xomoni</h1></html>',
      }),
  );

  await context.route(
    (url) => url.origin === CLOUD_URL,
    async (route) => {
      const request = route.request();
      const fn = new URL(request.url()).pathname.replace('/rest/v1/rpc/', '');
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      site.calls.push({ fn, body });
      const answer = (status: number, json: unknown) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
      const refuse = (hint: string) => answer(400, { code: 'P0001', hint, message: hint });
      if (fn === 'pair_device') {
        if (body.code !== CODE) return refuse('bad_code');
        paired = true;
        return answer(200, [{ device_id: DEVICE_ID, token: TOKEN, account: SITE_ACCOUNT }]);
      }
      if (!paired || body.token !== TOKEN) return refuse('unknown_device');
      switch (fn) {
        case 'device_report':
          return answer(200, { ...(site.release ?? {}), stats: site.stats });
        case 'unpair_device':
          paired = false;
          return answer(200, null);
        case 'device_set_daily_stats':
          site.stats = body.enabled === true;
          return answer(200, site.stats);
        case 'device_report_stats':
          return site.stats ? answer(200, Array.isArray(body.rows) ? body.rows.length : 0) : refuse('stats_off');
        default:
          return answer(404, { message: `xomoni.com has no function ${fn}` });
      }
    },
  );
  return site;
}
