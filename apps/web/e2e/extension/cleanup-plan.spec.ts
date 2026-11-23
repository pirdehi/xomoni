import type { BrowserContext, Page } from '@playwright/test';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';
import { DEVICE_ID, SITE, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// A cleanup planned on xomoni.com, from Xomoni's side (docs/scenarios/235-website-cleanup-plan.md, #235, #345): Xomoni
// counts what a plan matches in its copy, and takes a plan to its own Cleanup page, filled in, where nothing starts
// until the person confirms. The built extension runs in a real browser on x.com served from synthetic fixtures
// (ADR-0040), with years of posts (`xHistory: 'long'`); xomoni.com is played at it (`serveXomoniSite`), sending what
// the website sends.

test.use({ xHistory: 'long' });

/** Posts older than 2023: the fixture account has three, from 2019, 2020 and 2021. */
const BEFORE_2023 = Date.UTC(2023, 0, 1);

/** A plan as the Cleanup place hands it over: posts older than 2023, threads kept, nothing else kept. */
const plan = (changes: Record<string, unknown> = {}) => ({
  target: 'post',
  before: BEFORE_2023,
  after: null,
  keepMinLikes: null,
  keepKeywords: [],
  skipSelfReplies: true,
  ...changes,
});

/** Xomoni's estimate of a plan, as it answers it. */
interface Estimate {
  ok: true;
  what: 'cleanup';
  estimate: { handle: string; matching: number; archive: boolean; perDay: number };
}

/** The person browsed their posts on X, and Xomoni is signed in from a xomoni.com page; returns the site and the page. */
async function ready(dashboard: Page, page: Page, context: BrowserContext, extensionId: string) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  const site = await serveXomoniSite(context);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  const cleanup = await context.newPage();
  await cleanup.goto(`${SITE}/dashboard/cleanup`);
  return { site, cleanup };
}

/** Asks Xomoni what `body` matches, as the Cleanup place does. */
const estimate = (site: XomoniSite, from: Page, extensionId: string, body: unknown, deviceId = DEVICE_ID) =>
  site.send(from, extensionId, { type: 'xomoni-read', what: 'cleanup', deviceId, plan: body });

/** Hands Xomoni a plan, as *Review and start in Xomoni* does. */
const handOver = (site: XomoniSite, from: Page, extensionId: string, body: unknown, deviceId = DEVICE_ID) =>
  site.send(from, extensionId, { type: 'xomoni-plan', deviceId, plan: body });

test.describe('a cleanup planned on xomoni.com, answered by Xomoni', { tag: '@task-235' }, () => {
  test('S235-25 Xomoni counts what a plan matches in its copy, with its pace a day and whether the archive is in', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, cleanup } = await ready(dashboard, page, context, extensionId);
    const answer = (await estimate(site, cleanup, extensionId, plan())) as Estimate;
    expect(answer).toMatchObject({ ok: true, what: 'cleanup' });
    expect(answer.estimate).toMatchObject({ handle: FIXTURE_ACCOUNT.handle, matching: 3, archive: false });
    expect(answer.estimate.perDay).toBeGreaterThan(0);
    const fewer = (await estimate(site, cleanup, extensionId, plan({ keepKeywords: ['old made-up'] }))) as Estimate;
    expect(fewer.estimate.matching).toBe(2);
  });

  test('S235-26 a plan opens Xomoni’s Cleanup page filled in, and nothing starts until the person confirms', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, cleanup } = await ready(dashboard, page, context, extensionId);
    expect(await handOver(site, cleanup, extensionId, plan())).toEqual({ ok: true, outcome: 'opened' });
    await dashboard.bringToFront();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
    await expect(dashboard.getByText('Planned on xomoni.com')).toBeVisible();
    await expect(dashboard.getByText(/The choices below come from the plan you made on xomoni\.com\./)).toBeVisible();
    await expect(dashboard.getByRole('main').getByRole('listitem')).toHaveCount(3);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByRole('main').getByRole('group')).toHaveCount(0);
    await dashboard.getByRole('tab', { name: 'Log' }).click();
    await expect(
      dashboard.getByText(
        'Cleanup planned on xomoni.com: posts older than 2023-01-01. Waiting for you to review it in Xomoni.',
      ),
    ).toBeVisible();
  });

  test('S235-27 an estimate or a plan for another account’s device is refused, and Cleanup isn’t touched', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, cleanup } = await ready(dashboard, page, context, extensionId);
    const other = '9e000000-0000-4000-8000-000000000999';
    expect(await estimate(site, cleanup, extensionId, plan(), other)).toEqual({ ok: false, reason: 'other_account' });
    expect(await handOver(site, cleanup, extensionId, plan(), other)).toEqual({ ok: false, reason: 'other_account' });
    await openPage(dashboard, 'Cleanup');
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
    await expect(dashboard.getByText('Planned on xomoni.com')).toHaveCount(0);
  });

  test('S235-28 a plan that makes no sense is refused as invalid', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, cleanup } = await ready(dashboard, page, context, extensionId);
    for (const bad of [
      plan({ before: Date.now() + 7 * 86_400_000 }),
      plan({ after: BEFORE_2023 }),
      plan({ target: 'follower' }),
      plan({ keepMinLikes: 0 }),
      plan({ keepKeywords: Array.from({ length: 21 }, (_, i) => `w${i}`) }),
      { ...plan(), startNow: true },
    ]) {
      expect(await estimate(site, cleanup, extensionId, bad)).toEqual({ ok: false, reason: 'invalid' });
      expect(await handOver(site, cleanup, extensionId, bad)).toEqual({ ok: false, reason: 'invalid' });
    }
    await openPage(dashboard, 'Cleanup');
    await expect(dashboard.getByText('Planned on xomoni.com')).toHaveCount(0);
  });

  test('S235-29 before Xomoni is signed in to xomoni.com, it counts nothing and takes no plan', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const site = await serveXomoniSite(context);
    const cleanup = await context.newPage();
    await cleanup.goto(`${SITE}/dashboard/cleanup`);
    expect(await estimate(site, cleanup, extensionId, plan())).toEqual({ ok: false, reason: 'not_connected' });
    expect(await handOver(site, cleanup, extensionId, plan())).toEqual({ ok: false, reason: 'not_connected' });
  });

  test('S235-30 the page takes the plan once: after a reload it is the plain form, and nothing was started', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, cleanup } = await ready(dashboard, page, context, extensionId);
    await handOver(site, cleanup, extensionId, plan());
    await dashboard.bringToFront();
    await expect(dashboard.getByText('Planned on xomoni.com')).toBeVisible();
    await dashboard.reload();
    await openPage(dashboard, 'Cleanup');
    await expect(dashboard.getByRole('heading', { level: 2, name: '1 · What to clean up' })).toBeVisible();
    await expect(dashboard.getByText('Planned on xomoni.com')).toHaveCount(0);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByRole('main').getByRole('group')).toHaveCount(0);
  });
});
