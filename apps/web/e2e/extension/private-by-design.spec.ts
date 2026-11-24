import type { BrowserContext, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';
import { DEVICE_ID, SITE, serveXomoniSite } from '../support/xomoni-site';

// Private by design (docs/scenarios/143-private-by-design.md, ADR-0004, #143, #345), in the extension: no telemetry, the
// person's posts, likes and copy kept in IndexedDB in this browser profile, and nothing of them sent anywhere. The
// built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040); the harness fails a test
// that reaches any host but x.com, and these tests also record what reaches x.com. The website's half is in
// e2e/private-by-design.spec.ts.

test.use({ xHistory: 'long' });

/** Every request `context` sends from now on, as `<method> <url>`, in order. */
function requests(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => sent.push(`${request.method()} ${request.url()}`));
  return sent;
}

/** The dashboard's pages, from the sidebar, with each page's heading. */
const PAGES = ['Home', 'Cleanup', 'Library', 'Vault', 'Activity', 'Watch', 'Settings'] as const;

/** What Xomoni's IndexedDB holds in the page `page` runs in: each database's name, and the copy's items there. */
async function xomoniDatabase(page: Page) {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((db) => db.name ?? '');
    if (!names.includes('xomoni')) return { names, items: [] as { text: string; kind: string }[] };
    const items = await new Promise<{ text: string; kind: string }[]>((resolve, reject) => {
      const open = indexedDB.open('xomoni');
      open.onerror = () => reject(new Error(String(open.error)));
      open.onsuccess = () => {
        const all = open.result.transaction('items').objectStore('items').getAll();
        all.onsuccess = () => resolve(all.result as { text: string; kind: string }[]);
        all.onerror = () => reject(new Error(String(all.error)));
      };
    });
    return { names, items };
  });
}

/**
 * Sends Xomoni `message` from a page of xomoni.com, through Chrome's own channel, as the website does (ADR-0025), and
 * returns Xomoni's answer.
 */
async function fromXomoniCom(context: BrowserContext, extensionId: string, message: unknown): Promise<unknown> {
  const site = await context.newPage();
  await site.goto(`${SITE}/dashboard`);
  const answer: unknown = await site.evaluate(
    ({ id, body }) => {
      const { chrome } = window as unknown as {
        chrome: { runtime: { sendMessage(id: string, message: unknown): Promise<unknown> } };
      };
      return chrome.runtime.sendMessage(id, body);
    },
    { id: extensionId, body: message },
  );
  await site.close();
  return answer;
}

/** xomoni.com's read of the Library's posts, as the website sends it (ADR-0028), naming `deviceId`. */
const libraryRead = (deviceId: string) => ({
  type: 'xomoni-read',
  what: 'library',
  deviceId,
  kind: 'post',
  query: '',
  offset: 0,
});

test.describe('private by design: the extension', { tag: '@task-143' }, () => {
  test('S143-01 the copy is kept in this browser’s own database, with each post’s text', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page);
    await openPage(dashboard, 'Home');
    await expect(
      dashboard.getByText(`@${FIXTURE_ACCOUNT.handle} · everything Xomoni knows stays in this browser.`),
    ).toBeVisible();

    const { items } = await xomoniDatabase(dashboard);
    expect(items.map((item) => item.text)).toContain('Our launch went well: thank you, everyone.');
    expect(new Set(items.map((item) => item.kind))).toEqual(new Set(['post', 'reply', 'repost', 'like']));
  });

  test('S143-02 x.com’s own pages can’t see Xomoni’s database: it belongs to the extension alone', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    // The person's own X tab, where Xomoni's content script runs: its storage is x.com's, and Xomoni's isn't in it.
    const x = await xomoniDatabase(page);
    expect(x.names).not.toContain('xomoni');
    expect(x.items).toEqual([]);
    expect((await xomoniDatabase(dashboard)).items.length).toBeGreaterThan(0);
  });

  test('S143-03 a fresh install sends nothing anywhere, through every page of the dashboard', async ({
    dashboard,
    context,
  }) => {
    const sent = requests(context);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(
      dashboard.getByText(
        'Your posts and likes stay in this browser. Signed in to xomoni.com, only job status goes there, and your daily numbers if you turn them on.',
      ),
    ).toBeVisible();
    for (const item of PAGES) {
      await dashboard.getByRole('navigation').getByRole('button', { name: item, exact: true }).click();
      await expect(dashboard.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    // Only the extension's own files: no telemetry, no update check, not even x.com before the person opens it.
    expect(sent.filter((r) => /^\S+ (https?|wss?):/.test(r))).toEqual([]);
  });

  test('S143-04 Xomoni’s pages can’t reach another site, even if something tried', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await dashboard.bringToFront();
    const refused = await dashboard.evaluate(async () => {
      const blocked: string[] = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        blocked.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
      const fetched = await fetch('https://tracker.example/collect', { method: 'POST', body: 'x' }).then(
        () => 'sent',
        () => 'refused',
      );
      const image = new Image();
      image.src = 'https://tracker.example/pixel.gif';
      await new Promise((resolve) => {
        image.onerror = resolve;
        image.onload = resolve;
      });
      const script = document.createElement('script');
      script.src = 'https://tracker.example/sdk.js';
      document.head.append(script);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { fetched, blocked };
    });
    expect(refused.fetched).toBe('refused');
    expect(refused.blocked).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^connect-src https:\/\/tracker\.example/),
        expect.stringMatching(/^img-src https:\/\/tracker\.example/),
        expect.stringMatching(/^script-src(-elem)? https:\/\/tracker\.example/),
      ]),
    );
  });

  test('S143-05 browsing X with Xomoni sends X nothing beyond what X’s own page asks for', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    const sent = requests(context);
    await browseProfile(page, ['posts']);
    // The page, then X's web app asking X's GraphQL API for the profile and its posts: X's requests, none of Xomoni's.
    expect(sent.map((r) => r.replace(/\?.*$/, ''))).toEqual([
      `GET https://x.com/${FIXTURE_ACCOUNT.handle}`,
      'GET https://x.com/i/api/graphql/fixtureQueryId/UserByScreenName',
      'GET https://x.com/i/api/graphql/fixtureQueryId/UserTweets',
    ]);
  });

  test('S143-06 not signed in to xomoni.com, a day’s use sends xomoni.com nothing', async ({
    dashboard,
    page,
    context,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    await browseProfile(page);
    for (const item of PAGES)
      await dashboard.getByRole('navigation').getByRole('button', { name: item, exact: true }).click();
    await openPage(dashboard, 'Settings');
    await expect(dashboard.getByRole('button', { name: 'Sign in to xomoni.com' })).toBeVisible();
    expect(site.calls).toEqual([]);
  });

  test('S143-07 signed in to xomoni.com, the daily numbers stay off until the person turns them on', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    await browseProfile(page);
    expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
    await openPage(dashboard, 'Settings');
    const numbers = dashboard.getByRole('switch', { name: 'Show my numbers on xomoni.com' });
    await expect(numbers).not.toBeChecked();
    await expect(dashboard.getByText(/Never your posts, replies, likes or anyone’s name\./)).toBeVisible();
    await expect.poll(() => site.calls.map((c) => c.fn)).toContain('device_report');
    expect(site.calls.map((c) => c.fn)).not.toContain('device_report_stats');
    expect(site.calls.map((c) => c.fn)).not.toContain('device_set_daily_stats');
  });

  test('S143-08 Xomoni never runs in incognito, so a private window’s X never reaches this profile’s copy', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await dashboard.bringToFront();
    const incognito = await dashboard.evaluate(async () => {
      // Chrome's own API, there on Xomoni's pages.
      const { chrome } = window as unknown as {
        chrome: {
          runtime: { getManifest(): { incognito?: string } };
          extension: { isAllowedIncognitoAccess(): Promise<boolean> };
        };
      };
      return {
        manifest: chrome.runtime.getManifest().incognito,
        allowed: await chrome.extension.isAllowedIncognitoAccess(),
      };
    });
    expect(incognito).toEqual({ manifest: 'not_allowed', allowed: false });
  });

  test('S143-09 the first run promises privacy in words, and its page passes axe', async ({ dashboard }) => {
    const promise = dashboard.getByText('Private by design');
    await expect(promise).toBeVisible();
    await expect(
      dashboard.getByText(
        'Your posts and likes stay in this browser. Signed in to xomoni.com, only job status goes there, and your daily numbers if you turn them on.',
      ),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test('S143-10 the copy is still there after a reload, and in a second dashboard tab', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const before = (await xomoniDatabase(dashboard)).items.length;
    expect(before).toBeGreaterThan(0);
    await dashboard.reload();
    expect((await xomoniDatabase(dashboard)).items.length).toBe(before);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/library`);
    await expect(second.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    expect((await xomoniDatabase(second)).items.length).toBe(before);
  });

  test('S143-17 x.com’s pages have no way to ask Xomoni for anything', async ({ dashboard, page }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    // Only xomoni.com may send Xomoni a message (`externally_connectable`): Chrome gives x.com's page no channel.
    expect(
      await page.evaluate(
        () =>
          typeof (window as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime
            ?.sendMessage,
      ),
    ).toBe('undefined');
  });

  test('S143-18 a message from xomoni.com of no shape Xomoni knows is refused, with nothing of the copy', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
    for (const message of [
      { ...libraryRead(DEVICE_ID), what: 'everything' },
      { ...libraryRead(DEVICE_ID), fields: ['text'] },
      { ...libraryRead(DEVICE_ID), offset: -1 },
      { type: 'xomoni-export' },
    ]) {
      const answer = await fromXomoniCom(context, extensionId, message);
      expect(answer).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  test('S143-19 xomoni.com’s read is refused until Xomoni is signed in to the same account', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    expect(await fromXomoniCom(context, extensionId, libraryRead(DEVICE_ID))).toMatchObject({
      ok: false,
      reason: 'not_connected',
    });
    expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
    // A page of another account names another browser.
    expect(
      await fromXomoniCom(context, extensionId, libraryRead('9e000000-0000-4000-8000-000000000999')),
    ).toMatchObject({ ok: false, reason: 'other_account' });
    // The page of the same account, in this browser, gets the copy, straight to the page.
    const answer = (await fromXomoniCom(context, extensionId, libraryRead(DEVICE_ID))) as {
      ok: boolean;
      page?: { items: { text: string }[] };
    };
    expect(answer.ok).toBe(true);
    expect(answer.page?.items.map((item) => item.text)).toContain('Our launch went well: thank you, everyone.');
    expect(JSON.stringify(site.calls)).not.toContain('Our launch went well');
  });

  test('S143-20 signing out with the account’s data removed empties the copy from this browser', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    expect((await xomoniDatabase(dashboard)).items.length).toBeGreaterThan(0);
    await dashboard.bringToFront();
    await dashboard
      .getByRole('complementary')
      .getByRole('button', { name: new RegExp(` @${FIXTURE_ACCOUNT.handle}$`) })
      .click();
    await dashboard
      .getByRole('dialog', { name: 'Connections' })
      .getByRole('button', { name: 'Sign out of Xomoni', exact: true })
      .click();
    const dialog = dashboard.getByRole('dialog', { name: 'Sign out of Xomoni?' });
    await dialog.getByRole('checkbox', { name: `Remove @${FIXTURE_ACCOUNT.handle}’s data from this browser` }).check();
    await dialog.getByRole('button', { name: 'Sign out and remove data', exact: true }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'You’re signed out' })).toBeVisible();
    expect((await xomoniDatabase(dashboard)).items).toEqual([]);
  });

  test('S143-21 a sign-in xomoni.com refuses leaves Xomoni signed out, and sends nothing more', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    // A code xomoni.com never made, or one already used.
    const answer = await fromXomoniCom(context, extensionId, { type: 'xomoni-sign-in', code: 'ZZZZZ-ZZZZZ' });
    expect(answer).toMatchObject({ ok: false, reason: 'bad_code' });
    expect(site.calls.map((call) => call.fn)).toEqual(['pair_device']);
    await openPage(dashboard, 'Settings');
    await expect(dashboard.getByRole('button', { name: 'Sign in to xomoni.com' })).toBeVisible();
    await openPage(dashboard, 'Activity');
    expect(site.calls.map((call) => call.fn)).toEqual(['pair_device']);
  });

  test('S143-26 the Library’s Export JSON is a file made on this computer, with nothing fetched', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const sent = requests(context);
    await dashboard.bringToFront();
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    const download = dashboard.waitForEvent('download');
    await dashboard.getByRole('button', { name: 'Export JSON' }).click();
    expect((await download).suggestedFilename()).toMatch(/^xomoni-posts-present-\d{4}-\d{2}-\d{2}\.json$/);
    // Only the network counts, not the browser's own icon of the download (Edge's edge://fileicon).
    expect(sent.filter((r) => /^\S+ (https?|wss?):/.test(r))).toEqual([]);
  });
});
