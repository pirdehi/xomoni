import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { type OwnPost, answerWithOwnPosts } from '../support/x-fixtures';
import { CLOUD_URL, DEVICE_ID, type SiteEntitlement, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// The plan in Xomoni (docs/scenarios/423-plan-in-xomoni.md, #423, ADR-0042): the plan of the xomoni.com account this
// browser is connected to, heard only from `device_report`'s answer, kept with 7 days of grace offline, shown in
// *Your plan* in Settings, and opening Reach's Plus parts through `PlanGate`. The built extension runs in a real browser
// on x.com served from synthetic fixtures (ADR-0040), and xomoni.com is played by `serveXomoniSite`.

const DAY = 86_400_000;
const UNTIL = new Date(Date.now() + 30 * DAY).toISOString();

/** A plan as xomoni.com's database writes it in `device_report`'s answer (`entitlement_of`). */
const plan = (tier: 'free' | 'plus' | 'pro', status: string | null = tier === 'free' ? null : 'active') => ({
  tier,
  status,
  valid_until: tier === 'free' && status === null ? null : UNTIL,
});

/** A post of the fixture account's, made `daysAgo` days ago and seen `views` times; ids in the fixtures' range. */
const own = (n: number, daysAgo: number, views: number): OwnPost => ({
  id: `9000000000000004${String(n).padStart(3, '0')}`,
  text: `Plan post ${String(n)}`,
  createdAt: Date.now() - daysAgo * DAY,
  views,
});

/** The person opened the X window and browsed their profile, which X showed with a few posts with their views. */
async function browsed(dashboard: Page, page: Page, context: BrowserContext) {
  await answerWithOwnPosts(context, 'UserTweets', [own(1, 10, 100), own(2, 11, 200), own(3, 12, 300)]);
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
}

/** What xomoni.com answers about the plan: an entitlement (any shape a test wants) and the sales switch. */
type PlanAnswer = { entitlement: unknown; live: boolean } | null;

/**
 * Makes xomoni.com answer `answer` about the plan from now on. Null leaves both fields out of `device_report`'s answer,
 * as a server older than plans did: JSON drops a field that is undefined.
 */
function setPlan(site: XomoniSite, answer: PlanAnswer) {
  site.entitlement = (answer?.entitlement ?? undefined) as SiteEntitlement;
  site.billingLive = (answer?.live ?? undefined) as boolean;
}

/** Signs Xomoni in to xomoni.com, which answers `answer` about the plan, and waits for its first report. */
async function signedIn(site: XomoniSite, extensionId: string, answer: PlanAnswer) {
  setPlan(site, answer);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  await expect.poll(() => site.calls.filter((call) => call.fn === 'device_report').length).toBeGreaterThan(0);
}

/** *Your plan* in Settings. */
async function planCard(dashboard: Page): Promise<Locator> {
  await openPage(dashboard, 'Settings');
  const card = dashboard.getByRole('region', { name: 'Your plan' });
  await expect(card).toBeVisible();
  return card;
}

/** Reach's comparisons, opened from the sidebar. */
async function comparisons(dashboard: Page): Promise<Locator> {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Reach', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
  const section = dashboard.getByRole('region', { name: 'Comparisons' });
  await expect(section).toBeVisible();
  return section;
}

const closed = (where: Locator) => where.getByRole('region', { name: 'Part of Plus' });

/**
 * Writes `value` under `key` in Xomoni's own IndexedDB, as only someone at this computer could, then reloads the
 * dashboard so it reads it: the plan kept, played older or tampered with.
 */
async function writeKv(dashboard: Page, key: string, value: unknown) {
  await dashboard.evaluate(
    ([k, v]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onerror = () => reject(new Error('IndexedDB'));
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ key: k, value: v });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('kv'));
        };
      }),
    [key, value] as const,
  );
  await dashboard.reload();
}

/** The plan Xomoni keeps for the connected browser, heard `ago` ms ago (negative: in the future). */
const keptPlus = (ago: number) => ({ tier: 'plus', status: 'active', validUntil: null, checkedAt: Date.now() - ago });

test.describe('the plan in Xomoni', { tag: '@task-423' }, () => {
  test('S423-01 before sales open, Your plan says Plus · preview and Reach’s comparisons are open', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('free'), live: false });
    await expect(await planCard(dashboard)).toContainText('Every Plus part is open, free, while Xomoni is in preview.');
    const section = await comparisons(dashboard);
    await expect(section.getByText('Plus · preview')).toBeVisible();
    await expect(closed(section)).toHaveCount(0);
  });

  test('S423-02 on Plus once sales are open, Your plan names it, when it renews and when it was checked', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    const card = await planCard(dashboard);
    await expect(card.getByText('Plus', { exact: true })).toBeVisible();
    await expect(card).toContainText(/Renews on .+\./);
    await expect(card).toContainText(/Last checked .+\./);
    const section = await comparisons(dashboard);
    await expect(closed(section)).toHaveCount(0);
    await expect(section.getByText('Plus', { exact: true })).toBeVisible();
  });

  test('S423-03 a plan bought on xomoni.com opens Reach’s Plus parts at Check now, with nothing imported again', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('free'), live: true });
    await expect(closed(await comparisons(dashboard))).toBeVisible();
    setPlan(site, { entitlement: plan('plus'), live: true });
    await (await planCard(dashboard)).getByRole('button', { name: 'Check now' }).click();
    await expect((await planCard(dashboard)).getByText('Plus', { exact: true })).toBeVisible();
    const section = await comparisons(dashboard);
    await expect(closed(section)).toHaveCount(0);
  });

  test('S423-04 on Pro, Your plan says Pro and every Plus part is open', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('pro'), live: true });
    await expect((await planCard(dashboard)).getByText('Pro', { exact: true })).toBeVisible();
    await expect(closed(await comparisons(dashboard))).toHaveCount(0);
  });

  test('S423-05 a plan Xomoni can’t read leaves the plan heard before as it was', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    setPlan(site, { entitlement: { tier: 'gold', status: 'active', valid_until: UNTIL }, live: true });
    const card = await planCard(dashboard);
    const reports = site.calls.length;
    await card.getByRole('button', { name: 'Check now' }).click();
    await expect.poll(() => site.calls.length).toBeGreaterThan(reports);
    await expect(card.getByText('Plus', { exact: true })).toBeVisible();
    await expect(closed(await comparisons(dashboard))).toHaveCount(0);
  });

  test('S423-06 an answer with no plan, from an older xomoni.com, changes nothing', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, null);
    await expect(await planCard(dashboard)).toContainText('Plus · preview');
    await expect(closed(await comparisons(dashboard))).toHaveCount(0);
  });

  test('S423-07 a plan kept with a check time still to come counts as Free, and says to set the clock', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    site.up = false;
    await writeKv(dashboard, `entitlement:${DEVICE_ID}`, keptPlus(-3_600_000));
    const section = await comparisons(dashboard);
    await expect(closed(section)).toContainText('Set the clock, and this opens again.');
  });

  test('S423-08 with xomoni.com down, the plan heard stays and Reach’s Plus parts stay open', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    site.up = false;
    const card = await planCard(dashboard);
    await card.getByRole('button', { name: 'Check now' }).click();
    await expect(card.getByRole('button', { name: 'Check now' })).toBeEnabled();
    await expect(card.getByText('Plus', { exact: true })).toBeVisible();
    await expect(closed(await comparisons(dashboard))).toHaveCount(0);
  });

  test('S423-09 a day with no answer keeps Plus open, saying until when', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    site.up = false;
    await writeKv(dashboard, `entitlement:${DEVICE_ID}`, keptPlus(2 * DAY));
    const section = await comparisons(dashboard);
    await expect(section.getByText('We couldn’t check your plan')).toBeVisible();
    await expect(section).toContainText(/Plus stays on until /);
    await expect(closed(section)).toHaveCount(0);
  });

  test('S423-10 after 7 days with no answer, Reach’s Plus parts close, saying nothing was deleted', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    site.up = false;
    await writeKv(dashboard, `entitlement:${DEVICE_ID}`, keptPlus(8 * DAY));
    const section = await comparisons(dashboard);
    await expect(closed(section)).toContainText('Nothing was deleted.');
    // The last 30 days stay free, with every post still there.
    await expect(dashboard.getByRole('table', { name: "Each post's reach" }).getByText('Plan post 1')).toBeVisible();
    await expect(await planCard(dashboard)).toContainText('counts as Free until it can. Nothing was deleted.');
  });

  test('S423-11 a page on x.com can’t set the plan', async ({ dashboard, page, context, extensionId }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('free'), live: true });
    // What a page on x.com can reach: its own window, and the extension's id through the runtime it can't call.
    await page.evaluate(() => {
      window.postMessage({ type: 'xomoni-plan', entitlement: { tier: 'pro' }, billing_live: true }, '*');
      window.postMessage(
        { entitlement: { tier: 'pro', status: 'active', valid_until: null }, billing_live: true },
        '*',
      );
    });
    await page.waitForTimeout(500);
    await expect((await planCard(dashboard)).getByText('Free', { exact: true })).toBeVisible();
    await expect(closed(await comparisons(dashboard))).toBeVisible();
  });

  test('S423-12 the plan asks nothing but xomoni.com’s device_report', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    const sent: string[] = [];
    dashboard.on('request', (request: Request) => sent.push(request.url()));
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    await (await planCard(dashboard)).getByRole('button', { name: 'Check now' }).click();
    await comparisons(dashboard);
    const outside = sent.filter((url) => !url.startsWith('chrome-extension://'));
    expect(outside.length).toBeGreaterThan(0);
    for (const url of outside) expect(url).toBe(`${CLOUD_URL}/rest/v1/rpc/device_report`);
  });

  test('S423-13 a closed part leads to plans on xomoni.com only, in a new tab', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('free'), live: true });
    const link = closed(await comparisons(dashboard)).getByRole('link', { name: 'See plans on xomoni.com' });
    await expect(link).toHaveAttribute('href', /^https:\/\/xomoni\.com\/pricing#ext=/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const manage = (await planCard(dashboard)).getByRole('link', { name: 'Manage on xomoni.com' });
    await expect(manage).toHaveAttribute('href', /^https:\/\/xomoni\.com\/account\/billing#ext=/);
  });

  test('S423-14 a browser never connected is a preview before sales open, with nothing to check', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsed(dashboard, page, context);
    const card = await planCard(dashboard);
    await expect(card).toContainText('Plus · preview');
    await expect(card.getByRole('button', { name: 'Check now' })).toBeDisabled();
    await expect(closed(await comparisons(dashboard))).toHaveCount(0);
  });

  test('S423-15 once sales are open, a browser that isn’t connected is Free, and says to connect', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsed(dashboard, page, context);
    await writeKv(dashboard, 'billingLive', true);
    const card = await planCard(dashboard);
    await expect(card.getByText('Free', { exact: true })).toBeVisible();
    await expect(card).toContainText('Connect this browser to xomoni.com to use a plan bought there.');
    await expect(closed(await comparisons(dashboard))).toBeVisible();
  });

  test('S423-16 a canceled plan stays open until its period ends, and says when', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus', 'canceled'), live: true });
    await expect(await planCard(dashboard)).toContainText(/Ends on .+\./);
    await expect(closed(await comparisons(dashboard))).toHaveCount(0);
  });

  test('S423-17 signing out of xomoni.com in Settings forgets the plan, and the posts stay', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Sign out of xomoni.com' }).click();
    await expect.poll(() => site.calls.map((call) => call.fn)).toContain('unpair_device');
    await expect((await planCard(dashboard)).getByText('Free', { exact: true })).toBeVisible();
    const section = await comparisons(dashboard);
    await expect(closed(section)).toBeVisible();
    await expect(dashboard.getByRole('table', { name: "Each post's reach" }).getByText('Plan post 1')).toBeVisible();
  });

  test('S423-18 Your plan and a closed part have no serious accessibility violation, light and dark', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('free'), live: true });
    for (const colorScheme of ['light', 'dark'] as const) {
      await dashboard.emulateMedia({ colorScheme });
      await planCard(dashboard);
      await expectNoSeriousA11yViolations(dashboard);
      await expect(closed(await comparisons(dashboard))).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);
    }
  });

  test('S423-19 with the keyboard alone, the person reaches Check now and Manage on xomoni.com', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    const card = await planCard(dashboard);
    await tabTo(card.getByRole('button', { name: 'Check now' }));
    await tabTo(card.getByRole('link', { name: 'Manage on xomoni.com' }));
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });
    test('S423-20 a closed part reads in dark mode, with its way to plans', async ({
      dashboard,
      page,
      context,
      extensionId,
    }) => {
      const site = await serveXomoniSite(context);
      await browsed(dashboard, page, context);
      await signedIn(site, extensionId, { entitlement: plan('free'), live: true });
      const gate = closed(await comparisons(dashboard));
      await expect(gate).toContainText('This is part of Plus. Your data stays here either way.');
      await expect(gate.getByRole('link', { name: 'See plans on xomoni.com' })).toBeVisible();
    });
  });

  test('S423-21 after a reload, the plan heard stays, even with xomoni.com down', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page, context);
    await signedIn(site, extensionId, { entitlement: plan('plus'), live: true });
    site.up = false;
    await dashboard.reload();
    await expect((await planCard(dashboard)).getByText('Plus', { exact: true })).toBeVisible();
    await expect(closed(await comparisons(dashboard))).toHaveCount(0);
  });
});
