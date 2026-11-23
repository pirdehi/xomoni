import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  acceptRisks,
  browseProfile,
  confirmCleanup,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  removeBefore,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';
import {
  CLOUD_URL,
  DEVICE_ID,
  SITE,
  SITE_ACCOUNT,
  SITE_CODE,
  type XomoniSite,
  serveXomoniSite,
} from '../support/xomoni-site';

// One sign-in for xomoni.com and Xomoni (docs/scenarios/232-one-sign-in.md, ADR-0024, ADR-0025, #228, #232, #345): the
// extension's side, in the built extension in a real browser. xomoni.com is played at the extension
// (`serveXomoniSite`): its pages send Xomoni the website's own messages (`@xomoni/bridge`) through Chrome's
// `externally_connectable`, and the functions Xomoni calls on xomoni.com's Supabase project answer from a small state.
// The website's side, with the extension played at its page, is in apps/web/e2e/one-sign-in.spec.ts.

/** What Xomoni answers xomoni.com's hello: how it stands, never its token. */
interface Hello {
  ok: boolean;
  state: {
    version: string;
    connection: { deviceId: string; account: string; connectedAt: number } | null;
    signedOutAt: number | null;
    leftAt: number;
  };
}

/** A page of xomoni.com, as the person has it open in this browser. */
async function sitePage(context: BrowserContext, path = '/dashboard'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${SITE}${path}`);
  return page;
}

/** Xomoni's answer to xomoni.com's hello, from `page`. */
async function hello(site: XomoniSite, page: Page, extensionId: string): Promise<Hello> {
  return (await site.send(page, extensionId, { type: 'xomoni-hello' })) as Hello;
}

/** The sidebar's account button, which opens Connections. */
const accountButton = (dashboard: Page): Locator =>
  dashboard.getByRole('complementary').getByRole('button', { name: new RegExp(` @${FIXTURE_ACCOUNT.handle}$`) });

/** Opens Connections from the sidebar, and returns its xomoni.com part. */
async function xomoniComPanel(dashboard: Page): Promise<Locator> {
  await dashboard.bringToFront();
  await accountButton(dashboard).click();
  return dashboard.getByRole('dialog', { name: 'Connections' }).getByRole('region', { name: 'xomoni.com' });
}

/** Settings' card *xomoni.com*. */
const cloudCard = (dashboard: Page): Locator =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { level: 2, name: 'xomoni.com' }) });

/** The page Xomoni shows while signed out. */
const signedOutHeading = (dashboard: Page): Locator =>
  dashboard.getByRole('heading', { level: 1, name: 'You’re signed out' });

/** The dashboard's toasts. */
const toasts = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'Notifications' });

/** The names of the functions Xomoni called on xomoni.com, in order. */
const called = (site: XomoniSite) => site.calls.map((call) => call.fn);

/**
 * The person's start: the X window open, and xomoni.com served, a page of it open. Returns the site and that page.
 */
async function start(dashboard: Page, context: BrowserContext): Promise<{ site: XomoniSite; page: Page }> {
  const site = await serveXomoniSite(context);
  await openXWindow(dashboard);
  // Xomoni has taken up the X window's account.
  await expect(dashboard.getByRole('main')).toContainText(`@${FIXTURE_ACCOUNT.handle} · everything Xomoni knows`);
  return { site, page: await sitePage(context) };
}

/**
 * Presses Settings' *Sign in to xomoni.com*, which opens xomoni.com/connect with Xomoni's id and a fresh nonce in the
 * fragment, and returns that tab and the nonce.
 */
async function signInFromXomoni(dashboard: Page): Promise<{ tab: Page; nonce: string }> {
  await openPage(dashboard, 'Settings');
  const opened = dashboard.context().waitForEvent('page');
  await cloudCard(dashboard).getByRole('button', { name: 'Sign in to xomoni.com' }).click();
  const tab = await opened;
  await tab.waitForURL(/^https:\/\/xomoni\.com\/connect#/);
  const nonce = new URLSearchParams(new URL(tab.url()).hash.slice(1)).get('nonce') ?? '';
  return { tab, nonce };
}

test.describe('one sign-in, Xomoni’s side', { tag: '@task-232' }, () => {
  // Some scenarios set up a running job first, then sign in and out: more than a test's usual 30 seconds.
  test.describe.configure({ timeout: 60_000 });

  test('S232-01 signing in on xomoni.com signs Xomoni in, with no code to type', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    const answer = await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    expect(answer).toEqual({ ok: true, account: SITE_ACCOUNT, deviceId: DEVICE_ID });
    // Xomoni traded the website's one-time code for its own device, and reported at once: the account is the person's.
    expect(called(site).slice(0, 2)).toEqual(['pair_device', 'device_report']);
    expect(site.calls[0]?.body).toMatchObject({ code: SITE_CODE, version: expect.any(String) });

    const panel = await xomoniComPanel(dashboard);
    await expect(panel).toContainText('Connected');
    await expect(panel).toContainText(SITE_ACCOUNT);
  });

  test('S232-02 signing out on xomoni.com signs Xomoni out, and its X window closes', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    const xWindow = context.pages().find((p) => p.url() === 'https://x.com/home');
    expect(xWindow).toBeDefined();

    expect(await site.send(page, extensionId, { type: 'xomoni-sign-out' })).toEqual({ ok: true, signedOut: true });
    await dashboard.bringToFront();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await expect(dashboard.getByRole('main')).toContainText(`@${FIXTURE_ACCOUNT.handle}’s data is still here`);
    await expect.poll(() => xWindow?.isClosed()).toBe(true);
    expect(called(site)).toContain('unpair_device');
  });

  test('S232-03 Sign in to xomoni.com in Xomoni opens xomoni.com, which signs Xomoni in once the person is there', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    const { tab, nonce } = await signInFromXomoni(dashboard);
    expect(tab.url()).toBe(`${SITE}/connect#ext=${extensionId}&nonce=${nonce}`);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await dashboard.bringToFront();
    await expect(cloudCard(dashboard)).toContainText(
      'Finish on xomoni.com: sign in there, in the tab that opened. Xomoni here signs in with you.',
    );

    // The person signs in on that tab; xomoni.com hands over a code with Xomoni's nonce.
    expect(await site.send(tab, extensionId, { type: 'xomoni-pair', code: SITE_CODE, nonce })).toEqual({
      ok: true,
      account: SITE_ACCOUNT,
    });
    await dashboard.bringToFront();
    await expect(cloudCard(dashboard)).toContainText(`to ${SITE_ACCOUNT}`);
    await expect(cloudCard(dashboard).getByRole('button', { name: 'Sign out of xomoni.com' })).toBeVisible();
  });

  test('S232-04 signing out of Xomoni signs xomoni.com out the next time its page asks', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    const before = await hello(site, page, extensionId);
    expect(before.state.connection).toMatchObject({ deviceId: DEVICE_ID, account: SITE_ACCOUNT });
    expect(before.state.signedOutAt).toBeNull();

    await dashboard.bringToFront();
    await accountButton(dashboard).click();
    await dashboard
      .getByRole('dialog', { name: 'Connections' })
      .getByRole('button', { name: 'Sign out of Xomoni', exact: true })
      .click();
    await dashboard
      .getByRole('dialog', { name: 'Sign out of Xomoni?' })
      .getByRole('button', { name: 'Sign out', exact: true })
      .click();
    await expect(signedOutHeading(dashboard)).toBeVisible();

    // xomoni.com's page asks again, as it does when it comes back into view: Xomoni left, so the website signs out.
    const after = await hello(site, page, extensionId);
    expect(after.state.connection).toBeNull();
    expect(after.state.signedOutAt).toBeGreaterThan(0);
    expect(after.state.leftAt).toBe(after.state.signedOutAt);
    expect(called(site)).toContain('unpair_device');
  });

  test('S232-05 Sign out of xomoni.com signs the website out, and Xomoni goes on with the X account', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    const panel = await xomoniComPanel(dashboard);
    await panel.getByRole('button', { name: 'Sign out of xomoni.com' }).click();
    const confirm = dashboard.getByRole('dialog', { name: 'Sign out of xomoni.com?' });
    await expect(confirm).toContainText(
      `This browser stops sending job status to ${SITE_ACCOUNT}, and xomoni.com signs out in this browser too. Xomoni keeps working here on @${FIXTURE_ACCOUNT.handle}; sign in again here or on xomoni.com.`,
    );
    await confirm.getByRole('button', { name: 'Sign out of xomoni.com' }).click();
    await expect(toasts(dashboard)).toContainText('Signed out of xomoni.com in this browser');

    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    const state = (await hello(site, page, extensionId)).state;
    expect(state.connection).toBeNull();
    expect(state.signedOutAt).toBeNull();
    expect(state.leftAt).toBeGreaterThan(0);
    expect(called(site)).toContain('unpair_device');
  });

  test('S232-06 xomoni.com’s hello learns how Xomoni stands: its version and connection, never its token', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    const answer = await hello(site, page, extensionId);
    const version = await dashboard.evaluate(() => {
      const { chrome } = window as unknown as { chrome: { runtime: { getManifest(): { version: string } } } };
      return chrome.runtime.getManifest().version;
    });
    expect(answer).toEqual({
      ok: true,
      state: {
        version,
        connection: { deviceId: DEVICE_ID, account: SITE_ACCOUNT, connectedAt: expect.any(Number) },
        signedOutAt: null,
        leftAt: 0,
      },
    });
    expect(JSON.stringify(answer)).not.toContain('token');
  });

  test.describe('messages Xomoni refuses', () => {
    test('S232-07 a code with a nonce Xomoni didn’t ask for connects nothing', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const { site, page } = await start(dashboard, context);
      const answer = await site.send(page, extensionId, {
        type: 'xomoni-pair',
        code: SITE_CODE,
        nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      });
      expect(answer).toEqual({ ok: false, reason: 'not_asked' });
      expect(called(site)).toEqual([]);
      expect((await hello(site, page, extensionId)).state.connection).toBeNull();
    });

    test('S232-08 a code xomoni.com refuses connects nothing, and Xomoni says so to the page', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const { site, page } = await start(dashboard, context);
      expect(await site.send(page, extensionId, { type: 'xomoni-sign-in', code: 'ZZZZZ-99999' })).toEqual({
        ok: false,
        reason: 'bad_code',
      });
      expect((await hello(site, page, extensionId)).state.connection).toBeNull();
      const panel = await xomoniComPanel(dashboard);
      await expect(panel).toContainText('Not connected');
    });

    test('S232-09 a message out of shape gets invalid, and changes nothing', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const { site, page } = await start(dashboard, context);
      for (const message of [
        { type: 'xomoni-sign-in' },
        { type: 'xomoni-sign-in', code: SITE_CODE, extra: 'field' },
        { type: 'xomoni-sign-out', now: true },
        { type: 'xomoni-pair', code: 'not a code', nonce: 'short' },
        { type: 'something-else' },
        'xomoni-hello',
      ])
        expect(await site.send(page, extensionId, message), JSON.stringify(message)).toEqual({
          ok: false,
          reason: 'invalid',
        });
      expect(called(site)).toEqual([]);
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    });
  });

  test.describe('when xomoni.com fails', () => {
    test('S232-10 xomoni.com out of reach while signing in: Xomoni stays as it was, and says why to the page', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const { site, page } = await start(dashboard, context);
      await context.route(
        (url) => url.origin === CLOUD_URL,
        (route) => route.abort('internetdisconnected'),
      );
      expect(await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE })).toEqual({
        ok: false,
        reason: 'unreachable',
      });
      expect((await hello(site, page, extensionId)).state.connection).toBeNull();
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    });

    test('S232-11 xomoni.com out of reach while the website signs out: Xomoni signs out all the same', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const { site, page } = await start(dashboard, context);
      await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
      await context.route(
        (url) => url.origin === CLOUD_URL,
        (route) => route.abort('internetdisconnected'),
      );
      expect(await site.send(page, extensionId, { type: 'xomoni-sign-out' })).toEqual({ ok: true, signedOut: true });
      await dashboard.bringToFront();
      await expect(signedOutHeading(dashboard)).toBeVisible();
      expect((await hello(site, page, extensionId)).state.connection).toBeNull();
    });

    test('S232-12 a code handed over twice connects once: the nonce is used up', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const site = await serveXomoniSite(context);
      await openXWindow(dashboard);
      const { tab, nonce } = await signInFromXomoni(dashboard);
      // xomoni.com out of reach the first time: the nonce is used up all the same.
      const offline = (url: URL) => url.origin === CLOUD_URL;
      await context.route(offline, (route) => route.abort('internetdisconnected'));
      expect(await site.send(tab, extensionId, { type: 'xomoni-pair', code: SITE_CODE, nonce })).toEqual({
        ok: false,
        reason: 'unreachable',
      });
      await context.unroute(offline);
      expect(await site.send(tab, extensionId, { type: 'xomoni-pair', code: SITE_CODE, nonce })).toEqual({
        ok: false,
        reason: 'not_asked',
      });
      // Pressing Sign in to xomoni.com again starts afresh.
      const again = await signInFromXomoni(dashboard);
      expect(again.nonce).not.toBe(nonce);
      expect(
        await site.send(again.tab, extensionId, { type: 'xomoni-pair', code: SITE_CODE, nonce: again.nonce }),
      ).toEqual({
        ok: true,
        account: SITE_ACCOUNT,
      });
    });
  });

  test.describe('who may sign Xomoni in or out', () => {
    test('S232-13 only xomoni.com can reach Xomoni: x.com and a frame on xomoni.com can’t', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const { site, page } = await start(dashboard, context);
      // x.com, like any other site, has no way to send Xomoni a message.
      const x = await context.newPage();
      await x.goto('https://x.com/home');
      expect(
        await x.evaluate(() => typeof (window as unknown as { chrome?: { runtime?: unknown } }).chrome?.runtime),
      ).toBe('undefined');
      // A frame inside xomoni.com's page isn't the website's page: Xomoni doesn't answer it.
      await page.setContent(`<iframe src="${SITE}/frame"></iframe>`);
      const frame = page.frameLocator('iframe');
      await expect(frame.locator('h1')).toHaveText('Xomoni');
      const inFrame = page.frames()[1];
      if (!inFrame) throw new Error('the frame didn’t load');
      const answer = await inFrame.evaluate(
        ({ id, code }) =>
          new Promise((resolve) => {
            const { chrome } = window as unknown as {
              chrome: { runtime: { sendMessage(id: string, m: unknown, done: (a: unknown) => void): void } };
            };
            chrome.runtime.sendMessage(id, { type: 'xomoni-sign-in', code }, (a) => resolve(a ?? 'no answer'));
          }),
        { id: extensionId, code: SITE_CODE },
      );
      expect(answer).toBe('no answer');
      expect(called(site)).toEqual([]);
    });

    test('S232-14 a browser signed in to one account isn’t switched to another without saying which', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const { site, page } = await start(dashboard, context);
      await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
      // Another account's page, which doesn't name this browser's device as one to replace.
      expect(await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE })).toEqual({
        ok: false,
        reason: 'already_connected',
      });
      expect(called(site).filter((fn) => fn === 'pair_device')).toHaveLength(1);
      expect((await hello(site, page, extensionId)).state.connection).toMatchObject({ deviceId: DEVICE_ID });
    });

    test('S232-15 the website’s sign-out pauses a running job', async ({ dashboard, context, extensionId, page }) => {
      const site = await serveXomoniSite(context);
      await openXWindow(dashboard);
      await browseProfile(page, ['posts']);
      const hour = await dashboard.evaluate(() => new Date().getHours());
      await openPage(dashboard, 'Settings');
      await dashboard.getByRole('combobox', { name: 'From' }).selectOption(String((hour + 2) % 24));
      await dashboard.getByRole('combobox', { name: 'Until' }).selectOption(String((hour + 3) % 24));
      await expect(dashboard.getByRole('combobox', { name: 'Until' })).toHaveValue(String((hour + 3) % 24));
      await openCleanup(dashboard);
      await removeBefore(dashboard, '2022-01-01');
      await expect.poll(() => matching(dashboard)).toBe(2);
      await continueWithoutArchive(dashboard);
      await confirmCleanup(dashboard);
      await acceptRisks(dashboard);
      const card = jobCard(dashboard, 'Delete posts older than Jan 1, 2022');
      await expect(card).toContainText('Outside active hours');

      const tab = await sitePage(context);
      await site.send(tab, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
      await site.send(tab, extensionId, { type: 'xomoni-sign-out' });
      await dashboard.bringToFront();
      await expect(signedOutHeading(dashboard)).toBeVisible();
      // Back in with the X account: the job waits, paused, for the person.
      await dashboard.getByRole('main').getByRole('button', { name: 'Open X window' }).click();
      await dashboard.bringToFront();
      await dashboard.getByRole('button', { name: `Continue as @${FIXTURE_ACCOUNT.handle}` }).click();
      await openPage(dashboard, 'Activity');
      await expect(card.getByRole('button', { name: 'Resume' })).toBeEnabled();
    });
  });

  test('S232-16 an account stays optional: without one, Xomoni works, and xomoni.com learns nothing', async ({
    dashboard,
    context,
    extensionId,
    page,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await dashboard.bringToFront();
    await expect(dashboard.getByRole('region', { name: 'Counts' })).toContainText(/Posts\s*2/);
    const panel = await xomoniComPanel(dashboard);
    await expect(panel).toContainText('Not connected');
    await expect(panel.getByRole('button', { name: 'Sign in to xomoni.com' })).toBeVisible();
    const tab = await sitePage(context);
    expect(await hello(site, tab, extensionId)).toEqual({
      ok: true,
      state: { version: expect.any(String), connection: null, signedOutAt: null, leftAt: 0 },
    });
    expect(called(site)).toEqual([]);
  });

  test('S232-17 the website’s sign-out leaves a Xomoni that isn’t signed in as it was', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    expect(await site.send(page, extensionId, { type: 'xomoni-sign-out' })).toEqual({ ok: true, signedOut: false });
    await dashboard.bringToFront();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(signedOutHeading(dashboard)).toHaveCount(0);
    expect(called(site)).toEqual([]);
  });

  test('S232-18 Cancel keeps xomoni.com signed in', async ({ dashboard, context, extensionId }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    const panel = await xomoniComPanel(dashboard);
    await panel.getByRole('button', { name: 'Sign out of xomoni.com' }).click();
    const confirm = dashboard.getByRole('dialog', { name: 'Sign out of xomoni.com?' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    expect((await hello(site, page, extensionId)).state.connection).toMatchObject({ deviceId: DEVICE_ID });
    expect(called(site)).not.toContain('unpair_device');
  });

  test('S232-19 Cancel on a sign-in started in Xomoni: xomoni.com can no longer finish it', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await openXWindow(dashboard);
    const { tab, nonce } = await signInFromXomoni(dashboard);
    await dashboard.bringToFront();
    await cloudCard(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(cloudCard(dashboard).getByRole('button', { name: 'Sign in to xomoni.com' })).toBeVisible();
    expect(await site.send(tab, extensionId, { type: 'xomoni-pair', code: SITE_CODE, nonce })).toEqual({
      ok: false,
      reason: 'not_asked',
    });
    expect(called(site)).toEqual([]);
  });

  test('S232-20 signing out of xomoni.com works with the keyboard alone', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    await dashboard.bringToFront();
    await tabTo(accountButton(dashboard));
    await dashboard.keyboard.press('Enter');
    const button = dashboard
      .getByRole('dialog', { name: 'Connections' })
      .getByRole('button', { name: 'Sign out of xomoni.com' });
    await tabTo(button);
    await dashboard.keyboard.press('Enter');
    // The confirmation opens on its own Sign out of xomoni.com.
    const confirm = dashboard.getByRole('dialog', { name: 'Sign out of xomoni.com?' });
    await expect(confirm.getByRole('button', { name: 'Sign out of xomoni.com' })).toBeFocused();
    await dashboard.keyboard.press('Enter');
    await expect(toasts(dashboard)).toContainText('Signed out of xomoni.com in this browser');
    expect(called(site)).toContain('unpair_device');
  });

  test('S232-21 Connections, Settings’ card and the confirmation have no serious accessibility violation', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    await openPage(dashboard, 'Settings');
    await expect(cloudCard(dashboard)).toContainText(`to ${SITE_ACCOUNT}`);
    await expectNoSeriousA11yViolations(dashboard);
    const panel = await xomoniComPanel(dashboard);
    await expectNoSeriousA11yViolations(dashboard);
    await panel.getByRole('button', { name: 'Sign out of xomoni.com' }).click();
    await expect(dashboard.getByRole('dialog', { name: 'Sign out of xomoni.com?' })).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S232-22 signed in and waiting for xomoni.com read well, with no serious violation', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const site = await serveXomoniSite(context);
      await openXWindow(dashboard);
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      const { tab, nonce } = await signInFromXomoni(dashboard);
      await dashboard.bringToFront();
      await expect(cloudCard(dashboard)).toContainText('Finish on xomoni.com');
      await expectNoSeriousA11yViolations(dashboard);
      await site.send(tab, extensionId, { type: 'xomoni-pair', code: SITE_CODE, nonce });
      await dashboard.bringToFront();
      await expect(cloudCard(dashboard)).toContainText(`to ${SITE_ACCOUNT}`);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S232-23 signed in from xomoni.com, Xomoni stays signed in after a reload and in a second tab', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    await dashboard.reload();
    await openPage(dashboard, 'Settings');
    await expect(cloudCard(dashboard)).toContainText(`to ${SITE_ACCOUNT}`);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await expect(cloudCard(second)).toContainText(`to ${SITE_ACCOUNT}`);
    expect((await hello(site, page, extensionId)).state.connection).toMatchObject({ deviceId: DEVICE_ID });
  });

  test('S232-24 signed out by xomoni.com, Xomoni stays signed out after a reload, until the person signs in', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const { site, page } = await start(dashboard, context);
    await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE });
    await site.send(page, extensionId, { type: 'xomoni-sign-out' });
    await dashboard.bringToFront();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await dashboard.reload();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    // Signing in on xomoni.com again signs Xomoni in again, and ends the sign-out.
    expect(await site.send(page, extensionId, { type: 'xomoni-sign-in', code: SITE_CODE })).toMatchObject({ ok: true });
    await dashboard.bringToFront();
    await expect(signedOutHeading(dashboard)).toHaveCount(0);
    expect((await hello(site, page, extensionId)).state.signedOutAt).toBeNull();
  });
});
