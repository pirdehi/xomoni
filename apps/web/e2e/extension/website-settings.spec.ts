import type { BrowserContext, Page } from '@playwright/test';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';
import { DEVICE_ID, SITE, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// Xomoni's settings on xomoni.com, from Xomoni's side (docs/scenarios/234-website-settings.md, #234, ADR-0029, #345):
// Xomoni answers a page's read of its settings, and applies the few changes the website may make through its own
// rules, logging each one; it never takes a faster pace. The built extension runs in a real browser on x.com served
// from synthetic fixtures (ADR-0040); xomoni.com is played at it (`serveXomoniSite`), sending what the website sends.

/** Xomoni's settings as it answers them. */
interface SettingsAnswer {
  ok: true;
  settings: {
    preset: string;
    pace: Record<string, { perHour: number; perDay: number }>;
    activeHours: { enabled: boolean; start: number; end: number };
    notifications: boolean;
    whileAway: boolean;
    maxFailures: number;
    handle: string;
    watch: string[];
  };
}

/** The person opened the X window, and Xomoni is signed in from a xomoni.com page; returns the site and the page. */
async function ready(dashboard: Page, page: Page, context: BrowserContext, extensionId: string) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  const site = await serveXomoniSite(context);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  const settings = await context.newPage();
  await settings.goto(`${SITE}/dashboard/settings`);
  return { site, settings };
}

/** Reads Xomoni's settings, as the Settings place does. */
const read = (site: XomoniSite, from: Page, extensionId: string, deviceId = DEVICE_ID) =>
  site.send(from, extensionId, { type: 'xomoni-read', what: 'settings', deviceId });

/** Asks Xomoni to change its settings, as the Settings place does. */
const change = (site: XomoniSite, from: Page, extensionId: string, body: unknown, deviceId = DEVICE_ID) =>
  site.send(from, extensionId, { type: 'xomoni-settings', deviceId, change: body });

test.describe('Xomoni’s settings on xomoni.com, answered by Xomoni', { tag: '@task-234' }, () => {
  test('S234-25 Xomoni answers its settings: the pace of each action, hours, safety and the account’s searches', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, settings } = await ready(dashboard, page, context, extensionId);
    const answer = (await read(site, settings, extensionId)) as { ok: true; what: 'settings' } & SettingsAnswer;
    expect(answer).toMatchObject({ ok: true, what: 'settings' });
    expect(answer.settings.handle).toBe(FIXTURE_ACCOUNT.handle);
    expect(Object.keys(answer.settings.pace).sort()).toEqual(['delete', 'read', 'relike', 'unlike', 'unretweet']);
    expect(typeof answer.settings.activeHours.enabled).toBe('boolean');
    expect([1, 2, 3]).toContain(answer.settings.maxFailures);
    expect(Array.isArray(answer.settings.watch)).toBe(true);
  });

  test('S234-26 a change is applied by Xomoni, answered as stored, and written to its log', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, settings } = await ready(dashboard, page, context, extensionId);
    const answer = (await change(site, settings, extensionId, {
      activeHours: { enabled: true, start: 9, end: 22 },
      notifications: false,
    })) as SettingsAnswer;
    expect(answer.ok).toBe(true);
    expect(answer.settings.activeHours).toEqual({ enabled: true, start: 9, end: 22 });
    expect(answer.settings.notifications).toBe(false);
    expect(((await read(site, settings, extensionId)) as SettingsAnswer).settings.notifications).toBe(false);
    await openPage(dashboard, 'Activity');
    await dashboard.getByRole('tab', { name: 'Log' }).click();
    await expect(
      dashboard.getByText('Settings changed on xomoni.com: active hours 09:00–22:00, notifications off.'),
    ).toBeVisible();
  });

  test('S234-27 Careful is the only pace the website can set: a faster one, or numbers, are refused', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, settings } = await ready(dashboard, page, context, extensionId);
    const before = ((await read(site, settings, extensionId)) as SettingsAnswer).settings;
    for (const bad of [
      { preset: 'custom' },
      { preset: 'fast' },
      { pace: { delete: { perHour: 500, perDay: 5000 } } },
      { maxFailures: 10 },
      { activeHours: { enabled: true, start: 9, end: 25 } },
      { watch: ['a', 'b', 'c', 'd', 'e', 'f'] },
      {},
    ])
      expect(await change(site, settings, extensionId, bad)).toEqual({ ok: false, reason: 'invalid' });
    expect(((await read(site, settings, extensionId)) as SettingsAnswer).settings).toEqual(before);
    const careful = (await change(site, settings, extensionId, { preset: 'careful' })) as SettingsAnswer;
    expect(careful.settings.preset).toBe('careful');
  });

  test('S234-28 a read or a change for another account’s device is refused, and nothing changes', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, settings } = await ready(dashboard, page, context, extensionId);
    const other = '9e000000-0000-4000-8000-000000000999';
    expect(await read(site, settings, extensionId, other)).toEqual({ ok: false, reason: 'other_account' });
    expect(await change(site, settings, extensionId, { notifications: false }, other)).toEqual({
      ok: false,
      reason: 'other_account',
    });
    expect(((await read(site, settings, extensionId)) as SettingsAnswer).settings.notifications).toBe(true);
  });

  test('S234-29 before Xomoni is signed in to xomoni.com, it shows and changes nothing', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const site = await serveXomoniSite(context);
    const settings = await context.newPage();
    await settings.goto(`${SITE}/dashboard/settings`);
    expect(await read(site, settings, extensionId)).toEqual({ ok: false, reason: 'not_connected' });
    expect(await change(site, settings, extensionId, { notifications: false })).toEqual({
      ok: false,
      reason: 'not_connected',
    });
  });

  test('S234-30 Watch searches set from the website are the active account’s, and its Watch shows them', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, settings } = await ready(dashboard, page, context, extensionId);
    const answer = (await change(site, settings, extensionId, { watch: ['#rust', 'open source'] })) as SettingsAnswer;
    expect(answer.settings.watch).toEqual(['#rust', 'open source']);
    await dashboard.bringToFront();
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
    await expect(dashboard.getByRole('main')).toContainText('#rust');
    await expect(dashboard.getByRole('main')).toContainText('open source');
  });
});
