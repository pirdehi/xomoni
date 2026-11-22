import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { openPage } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { CLOUD_URL, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// Hear about new versions (docs/scenarios/151-update-notice.md, #151, #345), in the extension: a browser signed in to
// xomoni.com hears in each status report's answer whether a newer Xomoni is out, and whether it fixes a security
// problem, and the dashboard says so above every page. The built extension runs in a real browser (ADR-0040), with
// xomoni.com played at it (`serveXomoniSite`), whose `release` says which version is out. The answer itself, from
// xomoni.com's database, is in e2e/update-notice.spec.ts.

/** The version of the Xomoni under test, as its manifest says. */
let current = '';

/** The release page the notice links to. */
const RELEASES = 'https://github.com/pirdehi/xomoni/releases/latest';

/** The notice above every page that `version` is out. */
const notice = (dashboard: Page, version: string): Locator =>
  dashboard.locator('[data-tone]').filter({ hasText: new RegExp(`^Xomoni ${version.replaceAll('.', '\\.')} is out`) });

/** Any notice that a version is out. */
const anyNotice = (dashboard: Page): Locator =>
  dashboard.locator('[data-tone]').filter({ hasText: /^Xomoni \S+ is out/ });

/** A version after `version`: its minor number one up. */
function after(version: string): string {
  const [major, minor] = version.split('.').map(Number);
  return `${String(major)}.${String((minor ?? 0) + 1)}.0`;
}

/** xomoni.com played at the extension, telling it `release` is out, and Xomoni signed in to it from a page. */
async function signedIn(
  dashboard: Page,
  context: BrowserContext,
  extensionId: string,
  release: XomoniSite['release'],
): Promise<XomoniSite> {
  current = await dashboard.evaluate(() => {
    const { chrome } = window as unknown as { chrome: { runtime: { getManifest(): { version: string } } } };
    return chrome.runtime.getManifest().version;
  });
  const site = await serveXomoniSite(context, { release });
  await openXWindow(dashboard);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  await dashboard.bringToFront();
  return site;
}

/** The version under test, before a test signs in. */
async function version(dashboard: Page): Promise<string> {
  return dashboard.evaluate(() => {
    const { chrome } = window as unknown as { chrome: { runtime: { getManifest(): { version: string } } } };
    return chrome.runtime.getManifest().version;
  });
}

test.describe('hear about new versions: the extension', { tag: '@task-151' }, () => {
  test('S151-01 when xomoni.com says a newer version is out, every page says so, with where to get it', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    await signedIn(dashboard, context, extensionId, { latest: next, security: false });
    const callout = notice(dashboard, next);
    await expect(callout).toBeVisible();
    await expect(callout).toHaveAttribute('data-tone', 'accent');
    await expect(callout).toContainText(`This browser runs ${current}.`);
    await expect(callout).toContainText(
      'Updating takes a minute: download the new version and load it in place of this one.',
    );
    await expect(callout.getByRole('link', { name: `Download ${next}` })).toHaveAttribute('href', RELEASES);
    for (const page of ['Library', 'Settings'] as const) {
      await dashboard.getByRole('navigation').getByRole('button', { name: page, exact: true }).click();
      await expect(notice(dashboard, next)).toBeVisible();
    }
  });

  test('S151-02 a release that fixes a security problem says so, and can’t be dismissed', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    await signedIn(dashboard, context, extensionId, { latest: next, security: true });
    const callout = notice(dashboard, next);
    await expect(callout).toContainText(`Xomoni ${next} is out, with a security fix`);
    await expect(callout).toHaveAttribute('data-tone', 'critical');
    await expect(callout).toContainText('Update soon: the new version fixes a security problem.');
    await expect(callout.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  });

  test('S151-03 Not now hides the notice for that version, and a newer one shows it again', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    const site = await signedIn(dashboard, context, extensionId, { latest: next, security: false });
    await notice(dashboard, next).getByRole('button', { name: 'Not now' }).click();
    await expect(anyNotice(dashboard)).toHaveCount(0);
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(anyNotice(dashboard)).toHaveCount(0);

    // A newer release, heard with the next report.
    const later = after(next);
    site.release = { latest: later, security: false };
    await dashboard.reload();
    await expect(notice(dashboard, later)).toBeVisible({ timeout: 15_000 });
  });

  test('S151-04 a version that isn’t newer than this one, or can’t be read, shows nothing', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const site = await signedIn(dashboard, context, extensionId, { latest: await version(dashboard), security: true });
    await expect.poll(() => site.calls.filter((c) => c.fn === 'device_report').length).toBeGreaterThan(0);
    await expect(anyNotice(dashboard)).toHaveCount(0);
    for (const latest of ['0.0.1', 'v99.0.0', '99.0', 'latest']) {
      site.release = { latest, security: true };
      const reports = site.calls.filter((c) => c.fn === 'device_report').length;
      await dashboard.reload();
      await expect.poll(() => site.calls.filter((c) => c.fn === 'device_report').length).toBeGreaterThan(reports);
      await expect(dashboard.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(anyNotice(dashboard), `no notice for ${latest}`).toHaveCount(0);
    }
  });

  test('S151-05 a browser not signed in to xomoni.com hears nothing, and asks no server', async ({
    dashboard,
    context,
  }) => {
    const site = await serveXomoniSite(context, { release: { latest: '99.0.0', security: true } });
    const sent: string[] = [];
    context.on('request', (request: Request) => sent.push(request.url()));
    await openXWindow(dashboard);
    await dashboard.bringToFront();
    await openPage(dashboard, 'Settings');
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(anyNotice(dashboard)).toHaveCount(0);
    expect(site.calls).toEqual([]);
    expect(sent.filter((url) => url.startsWith('https://github.com') || url.startsWith(CLOUD_URL))).toEqual([]);
  });

  test('S151-06 while xomoni.com can’t be reached, there is no notice and no error, and the next report brings it', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    // xomoni.com unreachable when Xomoni signs in: the sign-in itself fails, quietly.
    const unreachable = (url: URL) => url.origin === CLOUD_URL && url.pathname.endsWith('/device_report');
    const site = await serveXomoniSite(context, { release: { latest: next, security: false } });
    await context.route(unreachable, (route) => route.abort('internetdisconnected'));
    await openXWindow(dashboard);
    expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
    await dashboard.bringToFront();
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(anyNotice(dashboard)).toHaveCount(0);
    await expect(dashboard.getByRole('alert')).toHaveCount(0);

    await context.unroute(unreachable);
    await dashboard.reload();
    await expect(notice(dashboard, next)).toBeVisible({ timeout: 15_000 });
  });

  test('S151-07 a xomoni.com that says nothing about releases, as an older one did, shows nothing', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const site = await signedIn(dashboard, context, extensionId, null);
    await expect.poll(() => site.calls.filter((c) => c.fn === 'device_report').length).toBeGreaterThan(0);
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(anyNotice(dashboard)).toHaveCount(0);
  });

  test('S151-08 the notice downloads nothing by itself: its link opens GitHub’s release page in a new tab', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const sent: string[] = [];
    context.on('request', (request: Request) => sent.push(request.url()));
    const next = after(await version(dashboard));
    await signedIn(dashboard, context, extensionId, { latest: next, security: true });
    const link = notice(dashboard, next).getByRole('link', { name: `Download ${next}` });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/);
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
    // Nothing reached GitHub, nor anything else, until the person presses something.
    expect(sent.filter((url) => /github/.test(url))).toEqual([]);
  });

  test('S151-09 the version news comes from xomoni.com’s answer only: a status report says no more than before', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    const site = await signedIn(dashboard, context, extensionId, { latest: next, security: true });
    await expect(notice(dashboard, next)).toBeVisible();
    const report = site.calls.find((c) => c.fn === 'device_report')!;
    // Xomoni sends its version, its token and its jobs: it asks for nothing more to hear the news.
    expect(Object.keys(report.body).sort()).toEqual(['jobs', 'token', 'version']);
    expect(report.body.version).toBe(current);
  });

  test('S151-10 keyboard only: the notice’s link and Not now are reached, and Not now hides it', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    await signedIn(dashboard, context, extensionId, { latest: next, security: false });
    const callout = notice(dashboard, next);
    await tabTo(callout.getByRole('link', { name: `Download ${next}` }));
    await tabTo(callout.getByRole('button', { name: 'Not now' }));
    await dashboard.keyboard.press('Enter');
    await expect(anyNotice(dashboard)).toHaveCount(0);
  });

  test('S151-11 the notices, ordinary and for a security fix, have no serious accessibility violation', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    const site = await signedIn(dashboard, context, extensionId, { latest: next, security: false });
    await expect(notice(dashboard, next)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
    site.release = { latest: next, security: true };
    await dashboard.reload();
    await expect(notice(dashboard, next)).toContainText('with a security fix', { timeout: 15_000 });
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S151-12 the security notice has no serious accessibility violation in dark mode', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      const next = after(await version(dashboard));
      await signedIn(dashboard, context, extensionId, { latest: next, security: true });
      await expect(notice(dashboard, next)).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S151-13 the news is kept: a reload, a second tab, and a time xomoni.com can’t be reached still show it', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    await signedIn(dashboard, context, extensionId, { latest: next, security: true });
    await expect(notice(dashboard, next)).toBeVisible();
    await context.route(
      (url) => url.origin === CLOUD_URL,
      (route) => route.abort('internetdisconnected'),
    );
    await dashboard.reload();
    await expect(notice(dashboard, next)).toBeVisible();
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/library`);
    await expect(notice(second, next)).toBeVisible();
  });

  test('S151-20 a notice dismissed for one version doesn’t hide a later security fix', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    const next = after(await version(dashboard));
    const site = await signedIn(dashboard, context, extensionId, { latest: next, security: false });
    await notice(dashboard, next).getByRole('button', { name: 'Not now' }).click();
    await expect(anyNotice(dashboard)).toHaveCount(0);
    const fix = after(next);
    site.release = { latest: fix, security: true };
    await dashboard.reload();
    await expect(notice(dashboard, fix)).toContainText('with a security fix', { timeout: 15_000 });
    await expect(notice(dashboard, fix).getByRole('button', { name: 'Not now' })).toHaveCount(0);
  });

  test('S151-21 a fresh install, before the X window, shows no notice and has reported nothing', async ({
    dashboard,
    context,
  }) => {
    const site = await serveXomoniSite(context, { release: { latest: '99.0.0', security: true } });
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(anyNotice(dashboard)).toHaveCount(0);
    expect(site.calls).toEqual([]);
  });
});
