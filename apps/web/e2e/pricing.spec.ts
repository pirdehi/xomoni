import type { Page } from '@playwright/test';
import { TEST_FOUNDING_DISCOUNT, TEST_PRODUCTS, signTestEvent, subscriptionEvent } from '../test/fakes/polar';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { applyBillingEvent, createConfirmedUser, entitlementOf, setBillingLive } from './support/admin';
import { PASSWORD, expectDashboard, passwordInput, signIn, submit, uniqueEmail } from './support/flows';
import { hydrated } from './support/hydration';
import { FAKE_POLAR_PORT, type FakePolarServer, startFakePolar } from './support/polar';
import { expect, test } from './support/test';

// The plans and buying one, with the fake Polar (docs/scenarios/422-pricing-and-checkout.md, #422, ADR-0042). The
// pages for paid plans are shown (`BILLING_PAGES=1` in playwright.config.ts); sales are closed unless a test opens them
// with the service-role key, as the maintainer does, and closes them again. The website's server asks the fake Polar
// on 127.0.0.1:4010, which sends its signed events to the site's own webhook: nothing leaves the computer.

const WEBHOOK = 'http://localhost:3000/api/billing/webhook';
const DAY = 86_400_000;

let polar: FakePolarServer | null = null;

/** Starts the fake Polar where the site's server looks for it; `deliver: false` holds its events back. */
async function playPolar(deliver = true) {
  polar = await startFakePolar({ webhookUrl: WEBHOOK, port: FAKE_POLAR_PORT, deliver });
  return polar;
}

/** A new account, signed in on `page`; returns its user id. */
async function signedIn(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  const userId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  return userId;
}

/** Gives `userId` a plan, as Polar's webhook would. */
function givePlan(
  userId: string,
  {
    tier = 'plus',
    status = 'active',
    days = 20,
  }: { tier?: 'plus' | 'pro'; status?: 'active' | 'canceled' | 'past_due'; days?: number } = {},
) {
  return applyBillingEvent({
    webhook_id: `seed_${userId}_${status}_${Date.now()}`,
    event_type: 'subscription.updated',
    event_at: new Date().toISOString(),
    user_id: userId,
    tier,
    status,
    source: 'subscription',
    valid_until: new Date(Date.now() + days * DAY).toISOString(),
  });
}

/** The page's own message of failure: Next.js's route announcer is an alert too, outside `main`. */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

/** One plan's card on /pricing. */
const card = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
/** The billing page's card. */
const billing = (page: Page) => page.getByRole('region', { name: 'Plan and billing' });

/** Opens /pricing and waits for React, so a purchase goes through its Server Action. */
async function pricing(page: Page) {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { level: 1, name: 'Plans' })).toBeVisible();
  await hydrated(page.getByRole('radio', { name: 'Monthly' }));
}

/** Clicks a buy button once React drives it. */
async function buy(page: Page, name: string) {
  await (await hydrated(page.getByRole('button', { name }))).click();
}

/** Opens /account/billing and waits for React. */
async function billingPage(page: Page, query = '') {
  await page.goto(`/account/billing${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await hydrated(page.getByRole('button', { name: 'Refresh' }));
}

/** The date as the pages write it. */
const written = (date: Date) =>
  date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

test.afterEach(async () => {
  await polar?.close();
  polar = null;
  await setBillingLive(false);
});

test.describe('before sales open (#422)', () => {
  test(
    'S422-01 a visitor sees the plans, each paid one a preview, and nothing to buy',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const fake = await playPolar();
      await pricing(page);
      for (const name of ['Free', 'Plus', 'Pro', '30 days of Plus']) await expect(card(page, name)).toBeVisible();
      await expect(card(page, 'Plus').getByText('Plus · preview')).toBeVisible();
      await expect(page.getByText('Paid plans aren’t on sale yet.')).toBeVisible();
      const soon = card(page, 'Pro').getByRole('button', { name: 'Pro: coming soon' });
      await expect(soon).toHaveAttribute('aria-disabled', 'true');
      await soon.click({ force: true });
      await expect(page.getByRole('button', { name: /^Buy/ })).toHaveCount(0);
      expect(fake.api.requests).toEqual([]);
    },
  );

  test('S422-18 the billing page says paid plans aren’t on sale yet', { tag: ['@task-422'] }, async ({ page }) => {
    await signedIn(page, 'billing-closed');
    await billingPage(page);
    await expect(billing(page)).toContainText('Your plan: Free');
    await expect(billing(page)).toContainText('Paid plans aren’t on sale yet.');
  });
});

test.describe('once sales are open (#422)', () => {
  test.beforeEach(async () => {
    await setBillingLive(true);
  });

  test(
    'S422-02 a person on Free buys Plus monthly and comes back to Plus',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const fake = await playPolar();
      const userId = await signedIn(page, 'buy-plus');
      await pricing(page);
      await buy(page, 'Buy Plus, monthly');
      await expect(page.getByRole('heading', { name: 'Checkout (fake Polar)' })).toBeVisible();
      expect(fake.checkouts).toMatchObject([
        { externalCustomerId: userId, productId: TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY, discountId: null },
      ]);
      await page.getByRole('link', { name: 'Pay' }).click();
      await expect(page).toHaveURL(/\/account\/billing\?checkout=done/);
      await expect(billing(page)).toContainText('Your plan: Plus');
      expect(await entitlementOf(userId)).toEqual({
        tier: 'plus',
        status: 'active',
        source: 'subscription',
        founding: false,
      });
    },
  );

  test('S422-03 Pro yearly carries the founders’ discount', { tag: ['@task-422'] }, async ({ page }) => {
    const fake = await playPolar();
    const userId = await signedIn(page, 'buy-pro');
    await pricing(page);
    await page.getByRole('radio', { name: 'Yearly' }).check();
    await buy(page, 'Buy Pro, yearly');
    await expect(page.getByRole('heading', { name: 'Checkout (fake Polar)' })).toBeVisible();
    expect(fake.checkouts[0]).toMatchObject({
      productId: TEST_PRODUCTS.POLAR_PRODUCT_PRO_YEARLY,
      discountId: TEST_FOUNDING_DISCOUNT,
    });
    await page.getByRole('link', { name: 'Pay' }).click();
    await expect(billing(page)).toContainText('Your plan: Pro');
    expect(await entitlementOf(userId)).toMatchObject({ tier: 'pro', founding: true });
  });

  test('S422-04 a buyer opens Polar’s customer portal from Billing', { tag: ['@task-422'] }, async ({ page }) => {
    const fake = await playPolar();
    const userId = await signedIn(page, 'portal');
    fake.api.customers.add(userId);
    await givePlan(userId);
    await billingPage(page);
    await page.getByRole('button', { name: 'Manage billing' }).click();
    await expect(page.getByRole('heading', { name: 'Customer portal (fake Polar)' })).toBeVisible();
  });

  test('S422-05 a person buys 30 days of Plus, once', { tag: ['@task-422'] }, async ({ page }) => {
    await playPolar();
    const userId = await signedIn(page, 'pass');
    await pricing(page);
    await buy(page, 'Buy 30 days of Plus');
    await page.getByRole('link', { name: 'Pay' }).click();
    await expect(billing(page)).toContainText('Your plan: Plus');
    expect(await entitlementOf(userId)).toMatchObject({ tier: 'plus', source: 'pass' });
  });

  test(
    'S422-06 a plan changed in the page is refused, and Polar is asked nothing',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const fake = await playPolar();
      await signedIn(page, 'tamper-plan');
      await pricing(page);
      await card(page, 'Plus')
        .locator('input[name="plan"]')
        .evaluate((input) => {
          (input as HTMLInputElement).value = 'gold';
        });
      await buy(page, 'Buy Plus, monthly');
      await expect(alert(page)).toContainText('That plan isn’t one we sell.');
      expect(fake.checkouts).toEqual([]);
    },
  );

  test('S422-07 a period changed in the page is refused too', { tag: ['@task-422'] }, async ({ page }) => {
    const fake = await playPolar();
    await signedIn(page, 'tamper-interval');
    await pricing(page);
    await card(page, 'Pro')
      .locator('input[name="interval"]')
      .evaluate((input) => {
        (input as HTMLInputElement).value = 'week';
      });
    await buy(page, 'Buy Pro, monthly');
    await expect(alert(page)).toContainText('That plan isn’t one we sell.');
    expect(fake.checkouts).toEqual([]);
  });

  test(
    'S422-08 a person who pays by now is sent to Billing, not to a second checkout',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const fake = await playPolar();
      const userId = await signedIn(page, 'second-checkout');
      await pricing(page);
      await givePlan(userId);
      await buy(page, 'Buy Pro, monthly');
      await expect(page).toHaveURL(/\/account\/billing$/);
      await expect(billing(page)).toContainText('Your plan: Plus');
      expect(fake.checkouts).toEqual([]);
    },
  );

  test(
    'S422-09 with Polar unreachable, nothing is charged and the page says so',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const userId = await signedIn(page, 'polar-down');
      await pricing(page);
      await buy(page, 'Buy Plus, monthly');
      await expect(alert(page)).toContainText('We couldn’t reach Polar, our payment provider. Nothing was charged.');
      expect(await entitlementOf(userId)).toBeNull();
    },
  );

  test(
    'S422-10 when Polar’s event is late, Billing confirms, and Refresh brings the plan',
    { tag: ['@task-422'] },
    async ({ page }) => {
      await playPolar(false);
      await signedIn(page, 'late-event');
      await pricing(page);
      await buy(page, 'Buy Plus, monthly');
      await page.getByRole('link', { name: 'Pay' }).click();
      await expect(page.getByRole('status')).toContainText('Confirming your payment…');
      await (await hydrated(page.getByRole('button', { name: 'Refresh' }))).click();
      await expect(page.getByText('Your plan is up to date with Polar.')).toBeVisible();
      await page.reload();
      await expect(billing(page)).toContainText('Your plan: Plus');
    },
  );

  test(
    'S422-11 with Polar unreachable, the portal doesn’t open and the page says so',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const userId = await signedIn(page, 'portal-down');
      await givePlan(userId);
      await billingPage(page);
      await page.getByRole('button', { name: 'Manage billing' }).click();
      await expect(alert(page)).toContainText('We couldn’t reach Polar');
      await expect(page).toHaveURL(/\/account\/billing/);
    },
  );

  test('S422-12 a visitor signs in to buy, and comes back to the plans', { tag: ['@task-422'] }, async ({ page }) => {
    const email = uniqueEmail('visitor-buys');
    await createConfirmedUser(email, PASSWORD);
    await pricing(page);
    await card(page, 'Plus').getByRole('link', { name: 'Sign in to buy Plus' }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fpricing$/);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await passwordInput(page).fill(PASSWORD);
    await submit(page, 'Sign in');
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(card(page, 'Plus').getByRole('button', { name: 'Buy Plus, monthly' })).toBeVisible();
  });

  test(
    'S422-15 the pages ask only the site and its Supabase, and Polar nothing until a purchase',
    { tag: ['@task-422'] },
    async ({ page, baseURL }) => {
      const fake = await playPolar();
      const allowed = new Set([
        new URL(baseURL ?? 'http://localhost:3000').host,
        new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').host,
      ]);
      // After signing in: the sign-in page loads Cloudflare's Turnstile, which is not this page's doing.
      await signedIn(page, 'no-requests');
      const elsewhere: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith('http') && !allowed.has(url.host)) elsewhere.push(url.href);
      });
      await pricing(page);
      await billingPage(page);
      expect(elsewhere).toEqual([]);
      expect(fake.api.requests).toEqual([]);
    },
  );

  test(
    'S422-17 a person who never bought sees Free, and nothing to manage',
    { tag: ['@task-422'] },
    async ({ page }) => {
      await playPolar();
      await signedIn(page, 'never-bought');
      await billingPage(page);
      await expect(billing(page)).toContainText('Your plan: Free');
      await page.getByRole('button', { name: 'Manage billing' }).click();
      await expect(alert(page)).toContainText('You haven’t bought a plan yet');
    },
  );

  test('S422-19 going back from Polar’s checkout pays nothing', { tag: ['@task-422'] }, async ({ page }) => {
    await playPolar();
    const userId = await signedIn(page, 'back-from-checkout');
    await pricing(page);
    await buy(page, 'Buy Plus, monthly');
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(card(page, 'Plus').getByRole('button', { name: 'Buy Plus, monthly' })).toBeVisible();
    expect(await entitlementOf(userId)).toBeNull();
  });

  test(
    'S422-20 a canceled plan says until when it stays, and won’t renew',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const userId = await signedIn(page, 'canceled');
      await givePlan(userId, { status: 'canceled', days: 12 });
      const until = new Date(Date.now() + 12 * DAY);
      await billingPage(page);
      await expect(billing(page)).toContainText(`Canceled: it stays until ${written(until)}, and won’t renew.`);
      await expect(page.getByRole('button', { name: 'Manage billing' })).toBeVisible();
    },
  );

  test('S422-22 the keyboard alone chooses yearly and buys Plus', { tag: ['@task-422'] }, async ({ page }) => {
    await playPolar();
    await signedIn(page, 'keyboard');
    await pricing(page);
    await page.getByRole('radio', { name: 'Monthly' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Yearly' })).toBeChecked();
    const target = card(page, 'Plus').getByRole('button', { name: 'Buy Plus, yearly' });
    await hydrated(target);
    for (let i = 0; i < 30 && !(await target.evaluate((node) => node === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Checkout (fake Polar)' })).toBeVisible();
  });
});

test.describe('who sees what (#422)', () => {
  test(
    'S422-13 a visitor sent to Billing signs in first, and comes back there',
    { tag: ['@task-422'] },
    async ({ page }) => {
      await page.goto('/account/billing');
      await expect(page).toHaveURL(/\/login\?next=(%2F|\/)account(%2F|\/)billing$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    },
  );

  test('S422-14 each person sees only their own plan', { tag: ['@task-422'] }, async ({ page }) => {
    const someone = await createConfirmedUser(uniqueEmail('someone-pays'), PASSWORD);
    await givePlan(someone, { tier: 'pro' });
    await signedIn(page, 'someone-else');
    await billingPage(page);
    await expect(billing(page)).toContainText('Your plan: Free');
    await expect(billing(page)).not.toContainText('Pro');
  });

  test(
    'S422-16 an event without Polar’s signature gives nobody a plan',
    { tag: ['@task-422'] },
    async ({ request }) => {
      const userId = await createConfirmedUser(uniqueEmail('unsigned'), PASSWORD);
      const event = subscriptionEvent('subscription.active', userId);
      const unsigned = await request.post('/api/billing/webhook', {
        data: Buffer.from(JSON.stringify(event), 'utf8'),
        headers: { 'content-type': 'application/json' },
      });
      expect(unsigned.status()).toBe(401);
      const stale = signTestEvent(event, { timestamp: Math.floor(Date.now() / 1000) - 3600 });
      const old = await request.post('/api/billing/webhook', {
        data: Buffer.from(stale.body, 'utf8'),
        headers: { ...stale.headers, 'content-type': 'application/json' },
      });
      expect(old.status()).toBe(401);
      expect(await entitlementOf(userId)).toBeNull();
    },
  );

  test(
    'S422-21 no serious accessibility violation, in light and dark mode',
    { tag: ['@task-422'] },
    async ({ page }) => {
      const userId = await signedIn(page, 'a11y-billing');
      await givePlan(userId, { status: 'past_due' });
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await setBillingLive(false);
        await pricing(page);
        await expectNoSeriousA11yViolations(page, { soft: true });
        await setBillingLive(true);
        await pricing(page);
        await expectNoSeriousA11yViolations(page, { soft: true });
        await billingPage(page);
        await expect(billing(page)).toContainText('Your last payment didn’t go through.');
        await expectNoSeriousA11yViolations(page, { soft: true });
      }
    },
  );

  test(
    'S422-23 on a phone, nothing is wider than the screen and axe finds nothing serious',
    { tag: ['@task-422'] },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const userId = await signedIn(page, 'phone-billing');
      await givePlan(userId);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await pricing(page);
        expect(await overflow()).toBeLessThanOrEqual(0);
        await expectNoSeriousA11yViolations(page, { soft: true });
        await billingPage(page);
        expect(await overflow()).toBeLessThanOrEqual(0);
        await expectNoSeriousA11yViolations(page, { soft: true });
      }
    },
  );

  test(
    'S422-24 the plan is the same after a reload and in a second tab',
    { tag: ['@task-422'] },
    async ({ page, context }) => {
      const userId = await signedIn(page, 'persist');
      await givePlan(userId, { tier: 'pro' });
      await billingPage(page);
      await expect(billing(page)).toContainText('Your plan: Pro');
      await page.reload();
      await expect(billing(page)).toContainText('Your plan: Pro');
      const second = await context.newPage();
      await second.goto('/account/billing');
      await expect(billing(second)).toContainText('Your plan: Pro');
      await second.close();
    },
  );
});
