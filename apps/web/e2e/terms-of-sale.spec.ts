import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { expect, test } from './support/test';

// The pages for paid plans (docs/scenarios/420-terms-of-sale.md, #420, ADR-0042): the terms of sale, the refund
// policy, and the paid-plan parts of the privacy policy and the terms, all drafts waiting for the maintainer's approval.
// playwright.config.ts shows them (`BILLING_PAGES=1`), as a Preview does for the review; production keeps them off,
// which the unit tests of each page, the footer and the sitemap prove.

const DRAFT = 'Nothing on this page is in force yet, and paid plans aren’t on sale.';
// What no text about a paid plan may say: that Xomoni or a plan brings a result on X, or an account back.
const PROMISE =
  /\b(we|xomoni|a plan|your plan|it) (will|can|does) (restore|recover|unlock|unban|boost|grow|increase|get)\b|guarantee|get (your|an) account back/i;

/** Xomoni's contact address, as the pages link it. */
const CONTACT = /^[a-z]+@xomoni\.com$/;

const main = (page: Page) => page.getByRole('main');
const footerNav = (page: Page) => page.getByRole('contentinfo').getByRole('navigation', { name: 'Site' });
const heading = (page: Page, name: string, level = 1) => page.getByRole('heading', { level, name, exact: true });

/** Opens `path` and waits for its main heading. */
async function open(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(heading(page, title)).toBeVisible();
}

/** How far the page is wider than the window, in pixels (0 or less: it fits). */
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Fails every request for the site's scripts, as a browser that can't load them would. */
const blockScripts = (page: Page) => page.route(/\/_next\/static\/.*\.js(\?.*)?$/, (route) => route.abort());

test.describe('the terms of sale and the refund policy (#420)', () => {
  test(
    'S420-01 the Terms of Sale say who sells, what is bought and how it ends, as a draft',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await open(page, '/terms-of-sale', 'Terms of Sale');
      await expect(main(page)).toContainText('Draft');
      await expect(main(page)).toContainText(DRAFT);
      await expect(main(page)).toContainText('Paid plans are sold by Polar, our reseller and merchant of record.');
      await expect(main(page)).toContainText('Xomoni never sees or stores your card details.');
      await expect(main(page).getByRole('heading', { level: 2 })).toHaveText([
        'Who sells to you',
        'What you buy',
        'Price and taxes',
        'Renewal and cancelling',
        'When a plan ends',
        'Refunds',
        'No promise about X',
        'If we stop offering a plan',
        'Your rights',
        'Changes and contact',
      ]);
    },
  );

  test(
    'S420-02 the Refund Policy gives 14 days and says how to ask, as a draft',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await open(page, '/refunds', 'Refund Policy');
      await expect(main(page)).toContainText(DRAFT);
      await expect(main(page)).toContainText(
        'ask within 14 days of your first payment for it and you get all of it back',
      );
      await expect(main(page)).toContainText('The same goes for a one-time pass, within 14 days of buying it.');
      await expect(main(page)).toContainText('write to us within 14 days of it and we refund that renewal');
      await expect(main(page)).toContainText('Polar sends it back to your card or account');
      const contact = main(page).getByRole('link', { name: CONTACT }).first();
      await expect(contact).toHaveAttribute('href', `mailto:${await contact.textContent()}`);
    },
  );

  test(
    'S420-03 the footer lists Terms of sale and Refunds after Terms, and each opens its page',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await page.goto('/');
      const names = await footerNav(page).getByRole('link').allTextContents();
      expect(names.slice(names.indexOf('Terms'), names.indexOf('Terms') + 3)).toEqual([
        'Terms',
        'Terms of sale',
        'Refunds',
      ]);
      await footerNav(page).getByRole('link', { name: 'Terms of sale', exact: true }).click();
      await expect(page).toHaveURL(/\/terms-of-sale$/);
      await expect(heading(page, 'Terms of Sale')).toBeVisible();
      await footerNav(page).getByRole('link', { name: 'Refunds', exact: true }).click();
      await expect(page).toHaveURL(/\/refunds$/);
      await expect(heading(page, 'Refund Policy')).toBeVisible();
    },
  );

  test(
    'S420-04 the privacy policy names Polar and what is kept about a plan, as a draft',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await open(page, '/privacy', 'Privacy Policy');
      await expect(main(page)).toContainText('The parts about paid plans wait for the maintainer’s approval');
      const plan = main(page).getByRole('listitem').filter({ hasText: 'Your plan, only if you buy one:' });
      await expect(plan).toContainText('the plan (Free, Plus or Pro), its status, when it ends or renews');
      await expect(plan).toContainText('Never your card, your billing address or anything about your X account.');
      const polar = main(page).getByRole('listitem').filter({ hasText: 'sells our paid plans as merchant of record' });
      await expect(polar).toContainText('never anything about your X account');
    },
  );

  test(
    'S420-05 the terms of use send paid plans to the Terms of Sale, with still no guarantee',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await open(page, '/terms', 'Terms of Use');
      await expect(main(page)).toContainText('with or without one, Xomoni comes with no guarantee of any result');
      await main(page).getByRole('link', { name: 'Terms of Sale' }).click();
      await expect(page).toHaveURL(/\/terms-of-sale$/);
      await expect(heading(page, 'Terms of Sale')).toBeVisible();
    },
  );

  test('S420-06 /refund, without the s, is not found', { tag: ['@task-420'] }, async ({ page }) => {
    const answer = await page.goto('/refund');
    expect(answer?.status()).toBe(404);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
    await expect(page.getByText('Refund Policy')).toHaveCount(0);
  });

  test('S420-07 the address with capitals is not found', { tag: ['@task-420'] }, async ({ page }) => {
    const answer = await page.goto('/Terms-of-Sale');
    expect(answer?.status()).toBe(404);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  });

  test('S420-08 a part added to either address is not found', { tag: ['@task-420'] }, async ({ page }) => {
    for (const path of ['/terms-of-sale/plus', '/refunds/2026']) {
      const answer = await page.goto(path);
      expect(answer?.status(), path).toBe(404);
      await expect(page.getByText('This page could not be found.')).toBeVisible();
      await expect(page.getByText('merchant of record')).toHaveCount(0);
    }
  });

  test('S420-09 without Supabase, the Terms of Sale still show in full', { tag: ['@task-420'] }, async ({ page }) => {
    const supabase = new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').origin;
    await page.route(
      (url) => url.origin === supabase,
      (route) => route.abort(),
    );
    await open(page, '/terms-of-sale', 'Terms of Sale');
    await expect(main(page)).toContainText(DRAFT);
    await expect(main(page).getByRole('heading', { level: 2 })).toHaveCount(10);
  });

  test(
    'S420-10 without the site’s scripts, the Refund Policy still shows in full',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await blockScripts(page);
      await open(page, '/refunds', 'Refund Policy');
      await expect(main(page)).toContainText(DRAFT);
      await expect(main(page).getByRole('heading', { level: 2 })).toHaveCount(8);
      await expect(main(page).getByRole('link', { name: CONTACT }).first()).toBeVisible();
    },
  );

  test(
    'S420-11 without the site’s scripts, the terms of use still lead to the Terms of Sale',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await blockScripts(page);
      await open(page, '/terms', 'Terms of Use');
      await main(page).getByRole('link', { name: 'Terms of Sale' }).click();
      await expect(page).toHaveURL(/\/terms-of-sale$/);
      await expect(heading(page, 'Terms of Sale')).toBeVisible();
    },
  );

  test(
    'S420-12 neither page asks for anything: no form, text box or card field',
    { tag: ['@task-420'] },
    async ({ page }) => {
      for (const [path, title] of [
        ['/terms-of-sale', 'Terms of Sale'],
        ['/refunds', 'Refund Policy'],
      ] as const) {
        await open(page, path, title);
        await expect(page.locator('form, input, textarea, select')).toHaveCount(0);
        await expect(page.getByRole('textbox')).toHaveCount(0);
      }
    },
  );

  test(
    'S420-13 the pages ask nothing of Polar or any other site',
    { tag: ['@task-420'] },
    async ({ page, baseURL }) => {
      const allowed = new Set([
        new URL(baseURL ?? 'http://localhost:3000').host,
        new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').host,
      ]);
      const elsewhere: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith('http') && !allowed.has(url.host)) elsewhere.push(url.href);
      });
      await open(page, '/terms-of-sale', 'Terms of Sale');
      await page.waitForLoadState('networkidle');
      await open(page, '/refunds', 'Refund Policy');
      await page.waitForLoadState('networkidle');
      expect(elsewhere).toEqual([]);
    },
  );

  test('S420-14 neither page promises a result on X, or an account back', { tag: ['@task-420'] }, async ({ page }) => {
    await open(page, '/terms-of-sale', 'Terms of Sale');
    await expect(main(page)).toContainText('It changes nothing about how X treats your account.');
    await expect(main(page)).toContainText(
      'not more reach or followers, not fewer limits, and not that a limited, locked or suspended X account will be unlocked or restored',
    );
    expect(await main(page).textContent()).not.toMatch(PROMISE);
    await open(page, '/refunds', 'Refund Policy');
    await expect(main(page)).toContainText('it can’t change what X does to an account');
    expect(await main(page).textContent()).not.toMatch(PROMISE);
  });

  test('S420-15 both pages come with the site’s security headers', { tag: ['@task-420'] }, async ({ page }) => {
    for (const path of ['/terms-of-sale', '/refunds']) {
      const headers = (await page.goto(path))?.headers() ?? {};
      expect(headers['x-frame-options'], path).toBe('DENY');
      expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
      expect(headers['content-security-policy'], path).toContain("default-src 'self'");
    }
  });

  test(
    'S420-16 a visitor without an account reads both pages, with nothing asking them to sign in',
    { tag: ['@task-420'] },
    async ({ page }) => {
      for (const [path, title] of [
        ['/terms-of-sale', 'Terms of Sale'],
        ['/refunds', 'Refund Policy'],
      ] as const) {
        await open(page, path, title);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
      }
    },
  );

  test(
    'S420-17 before sales open, there is nothing to buy on either page',
    { tag: ['@task-420'] },
    async ({ page }) => {
      const buy = /\b(buy|upgrade|subscribe|checkout|pay now)\b/i;
      for (const [path, title] of [
        ['/terms-of-sale', 'Terms of Sale'],
        ['/refunds', 'Refund Policy'],
      ] as const) {
        await open(page, path, title);
        await expect(page.getByRole('link', { name: buy })).toHaveCount(0);
        await expect(page.getByRole('button', { name: buy })).toHaveCount(0);
      }
    },
  );

  test(
    'S420-18 cancelling: at any time, from the portal, until the end of the period paid for',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await open(page, '/terms-of-sale', 'Terms of Sale');
      const section = main(page).getByRole('list').filter({ hasText: 'renews automatically' });
      await expect(section).toContainText('until you cancel it');
      await expect(section).toContainText('You can cancel at any time from Polar’s customer portal');
      await expect(section).toContainText(
        'Your plan stays until the end of the period you have paid for, and you aren’t charged again.',
      );
      await expect(section).toContainText('A one-time pass ends by itself: there is nothing to cancel.');
      await expect(section).toContainText('Deleting your Xomoni account cancels your subscription first.');
    },
  );

  test('S420-19 Back from the Refund Policy returns to the home page', { tag: ['@task-420'] }, async ({ page }) => {
    await page.goto('/');
    await footerNav(page).getByRole('link', { name: 'Refunds', exact: true }).click();
    await expect(heading(page, 'Refund Policy')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page, 'Manage your digital footprint, starting with X.')).toBeVisible();
  });

  test(
    'S420-20 no serious accessibility violation, in light and dark mode',
    { tag: ['@task-420'] },
    async ({ page }) => {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        for (const [path, title] of [
          ['/terms-of-sale', 'Terms of Sale'],
          ['/refunds', 'Refund Policy'],
          ['/privacy', 'Privacy Policy'],
        ] as const) {
          await open(page, path, title);
          await expectNoSeriousA11yViolations(page, { soft: true });
        }
      }
    },
  );

  test(
    'S420-21 from the footer’s Terms, Tab reaches Terms of sale then Refunds, and Enter opens it',
    { tag: ['@task-420'] },
    async ({ page }) => {
      await page.goto('/');
      await footerNav(page).getByRole('link', { name: 'Terms', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(footerNav(page).getByRole('link', { name: 'Terms of sale', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(footerNav(page).getByRole('link', { name: 'Refunds', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/refunds$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Refund Policy']);
      await expect(main(page).getByRole('heading', { level: 2 })).toHaveCount(8);
    },
  );

  test('S420-22 on a phone, nothing is wider than the screen', { tag: ['@task-420'] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, title] of [
      ['/terms-of-sale', 'Terms of Sale'],
      ['/refunds', 'Refund Policy'],
    ] as const) {
      await open(page, path, title);
      await expect(main(page).getByText(DRAFT)).toBeInViewport();
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
    }
  });

  test(
    'S420-23 a reload and a second tab show the same text and Draft notice',
    { tag: ['@task-420'] },
    async ({ page, context }) => {
      await open(page, '/refunds', 'Refund Policy');
      await page.reload();
      await expect(heading(page, 'Refund Policy')).toBeVisible();
      await expect(main(page)).toContainText(DRAFT);
      const second = await context.newPage();
      await open(second, '/terms-of-sale', 'Terms of Sale');
      await expect(main(second)).toContainText(DRAFT);
      await second.close();
    },
  );
});
