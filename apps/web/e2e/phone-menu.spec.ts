import type { BrowserContext, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { AGENTS } from './support/browsers';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { hydrated } from './support/hydration';
import { refreshTokenOf } from './support/session';
import { expect, test } from './support/test';

// xomoni.com on a phone (docs/scenarios/242-phone-menu.md, #242, #345): the header's links folded into one menu below
// 768 px, How it works, Safety, Privacy, Install and GitHub, and the full footer under every page that has the site's
// header. The tests run against the local stack; github.com is played by the test where a scenario follows a link
// there, so nothing leaves the computer.

const REPOSITORY = 'https://github.com/pirdehi/xomoni';

/** The phone menu's items, in order, with where each leads. */
const MENU = [
  ['How it works', '/#how'],
  ['Safety', '/#safety'],
  ['Privacy', '/#privacy'],
  ['Install', '/install'],
  ['GitHub', REPOSITORY],
] as const;

/**
 * The footer's links, in order, with where each leads. The terms of sale and the refund policy are listed only while
 * the site shows the pages for paid plans (`BILLING_PAGES=1`, #420), as playwright.config.ts has it for the browser
 * tests; production keeps them off until the maintainer approves the texts.
 */
const FOOTER = [
  ['Install', '/install'],
  ['What’s new', `${REPOSITORY}/releases`],
  ['Algorithm digest', '/algorithm'],
  ['Risks', '/risks'],
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
  ...(process.env.BILLING_PAGES === '1'
    ? ([
        ['Terms of sale', '/terms-of-sale'],
        ['Refunds', '/refunds'],
      ] as const)
    : []),
  ['Security', `${REPOSITORY}/security/policy`],
  ['Support', `${REPOSITORY}/issues`],
  ['GitHub', REPOSITORY],
] as const;

/** The pages with the site's header and its phone menu, each with its main heading. */
const PUBLIC_PAGES = [
  ['/', 'Manage your digital footprint, starting with X.'],
  ['/install', 'Install Xomoni'],
  ['/risks', 'Before you start: the risks'],
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Use'],
] as const;

/** A phone held upright, an iPhone's 390 × 844. */
const PHONE = { width: 390, height: 844 };

const header = (page: Page) => page.getByRole('banner');
// Exact: a signed-in person's account button is named "Account menu for …", which a part match would find too.
const menuButton = (page: Page) => header(page).getByRole('button', { name: 'Menu', exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'Menu', exact: true });
const signInLink = (page: Page) => header(page).getByRole('link', { name: 'Sign in', exact: true });
const accountButton = (page: Page) => page.getByRole('button', { name: /^Account menu for / });
const footer = (page: Page) => page.getByRole('contentinfo');
const footerNav = (page: Page) => footer(page).getByRole('navigation', { name: 'Site' });

/** Opens the phone menu with the pointer, once React drives its button, and returns it. */
async function openMenu(page: Page) {
  await (await hydrated(menuButton(page))).click();
  await expect(menu(page)).toBeVisible();
  return menu(page);
}

/** Each item of the open phone menu, as its name and where it leads. */
const menuItems = (page: Page) =>
  menu(page)
    .getByRole('menuitem')
    .evaluateAll((items) => items.map((item) => [item.textContent, item.getAttribute('href')]));

/** Each link of the footer's list, as its name and where it leads. */
const footerLinks = (page: Page) =>
  footerNav(page)
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => [link.textContent, link.getAttribute('href')]));

/**
 * Waits until the home page's section `id` sits at the top of the screen, just below the sticky header (its scroll
 * margin), with its heading in view under the header: after the page's smooth scroll, if any.
 */
async function expectSectionAtTop(page: Page, id: string) {
  const section = page.locator(`section#${id}`);
  await expect
    .poll(() => section.evaluate((element) => Math.round(element.getBoundingClientRect().top)), {
      message: `#${id} lands below the header`,
    })
    .toBe(64);
  const bar = (await header(page).boundingBox())!;
  const heading = (await section.getByRole('heading', { level: 2 }).boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(heading.y + heading.height).toBeLessThanOrEqual(PHONE.height);
}

/** The page's width beyond the window's, if anything on it is wider than the window. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** How many entries the tab's history has. */
const historyLength = (page: Page) => page.evaluate(() => history.length);

/** Plays github.com: any page there answers with a page of its own, and the referrer of each request is kept. */
async function playGithub(context: BrowserContext) {
  const referrers: (string | undefined)[] = [];
  await context.route('https://github.com/**', (route) => {
    referrers.push(route.request().headers()['referer']);
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>pirdehi/xomoni</title><h1>pirdehi/xomoni</h1>',
    });
  });
  return referrers;
}

/** A new account with nothing yet, signed in on this browser; returns its email and id. */
async function newAccount(page: Page) {
  const email = uniqueEmail('phone-menu');
  const userId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  return { email, userId };
}

test.describe('xomoni.com on a phone', { tag: ['@task-242'] }, () => {
  test.use({ viewport: PHONE });

  test('S242-01 Safety from the menu brings the home page’s Safety section under the header, and the menu closes', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(header(page).getByRole('link', { name: 'Safety' })).toBeHidden();
    await (await openMenu(page)).getByRole('menuitem', { name: 'Safety' }).click();
    await expect(page).toHaveURL(/\/#safety$/);
    await expect(menu(page)).toBeHidden();
    await expectSectionAtTop(page, 'safety');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Under your oversight, within each platform’s limits.' }),
    ).toBeInViewport();
  });

  test('S242-02 GitHub from the menu opens the project’s repository', async ({ page, context }) => {
    await playGithub(context);
    await page.goto('/');
    await (await openMenu(page)).getByRole('menuitem', { name: 'GitHub' }).click();
    await expect(page).toHaveURL(REPOSITORY);
    await expect(page.getByRole('heading', { level: 1, name: 'pirdehi/xomoni' })).toBeVisible();
  });

  test('S242-03 every page with the site’s header ends with the full footer, within the phone’s width', async ({
    page,
  }) => {
    for (const [path, title] of PUBLIC_PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(footer(page)).toContainText('© 2026 Omid Pirdehi · MIT license · Not affiliated with X Corp.');
      await expect(footer(page).getByRole('link', { name: 'Omid Pirdehi' })).toHaveAttribute(
        'href',
        'https://github.com/pirdehi',
      );
      expect(await footerLinks(page)).toEqual(FOOTER.map(([name, href]) => [name, href]));
      await footer(page).scrollIntoViewIfNeeded();
      for (const link of await footerNav(page).getByRole('link').all()) {
        await expect(link).toBeInViewport();
        const box = (await link.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    }
  });

  test('S242-04 the footer’s Install, Risks, Privacy and Terms lead to their pages', async ({ page }) => {
    await page.goto('/');
    for (const [name, path, title] of [
      ['Install', '/install', 'Install Xomoni'],
      ['Risks', '/risks', 'Before you start: the risks'],
      ['Privacy', '/privacy', 'Privacy Policy'],
      ['Terms', '/terms', 'Terms of Use'],
    ] as const) {
      await footerNav(page).getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    }
  });

  test('S242-05 scrolled down to the footer, the menu is still at the top, and How it works brings the section back', async ({
    page,
  }) => {
    await page.goto('/');
    await footer(page).scrollIntoViewIfNeeded();
    await expect(footer(page)).toBeInViewport();
    await expect.poll(async () => (await header(page).boundingBox())?.y).toBe(0);
    await expect(menuButton(page)).toBeInViewport();
    await (await openMenu(page)).getByRole('menuitem', { name: 'How it works' }).click();
    await expect(page).toHaveURL(/\/#how$/);
    await expectSectionAtTop(page, 'how');
  });

  test('S242-06 How it works from another page opens the home page at that section', async ({ page }) => {
    await page.goto('/risks');
    await (await openMenu(page)).getByRole('menuitem', { name: 'How it works' }).click();
    await expect(page).toHaveURL(/\/#how$/);
    await expectSectionAtTop(page, 'how');
    await expect(
      page.getByRole('heading', { level: 2, name: 'A careful assistant in your browser, not a bot on a server.' }),
    ).toBeInViewport();
  });

  test('S242-07 on the privacy policy, the menu’s Privacy is the home page’s section, the footer’s the policy', async ({
    page,
  }) => {
    await page.goto('/privacy');
    await (await openMenu(page)).getByRole('menuitem', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/#privacy$/);
    await expectSectionAtTop(page, 'privacy');
    await footerNav(page).getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  });

  test('S242-08 Install on the install page loads it again, and Back still leads to the page before', async ({
    page,
  }) => {
    await page.goto('/risks');
    await page.goto('/install');
    const entries = await historyLength(page);
    await page.evaluate(() => Object.assign(window, { __before: true }));
    const loaded = page.waitForEvent('load');
    await (await openMenu(page)).getByRole('menuitem', { name: 'Install' }).click();
    await loaded;
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeVisible();
    expect(await page.evaluate(() => '__before' in window)).toBe(false);
    await expect(menu(page)).toBeHidden();
    expect(await historyLength(page)).toBe(entries);
    await page.goBack();
    await expect(page).toHaveURL(/\/risks$/);
  });

  test('S242-09 How it works again, scrolled away from it, brings the section back without a new history entry', async ({
    page,
  }) => {
    await page.goto('/');
    await (await openMenu(page)).getByRole('menuitem', { name: 'How it works' }).click();
    await expectSectionAtTop(page, 'how');
    const entries = await historyLength(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
    await (await openMenu(page)).getByRole('menuitem', { name: 'How it works' }).click();
    await expect(page).toHaveURL(/\/#how$/);
    await expectSectionAtTop(page, 'how');
    expect(await historyLength(page)).toBe(entries);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test('S242-10 a phone turned on its side with the menu open closes the menu and shows the header’s links', async ({
    page,
  }) => {
    await page.goto('/');
    await openMenu(page);
    // Still a phone's width: the menu stays, under its button.
    await page.setViewportSize({ width: 390, height: 700 });
    await expect(menu(page)).toBeVisible();
    // On its side, 844 px wide: the header has room for its links, and the menu closes rather than float over the logo.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(menu(page)).toBeHidden();
    await expect(menuButton(page)).toBeHidden();
    for (const name of ['How it works', 'Safety', 'Privacy', 'GitHub', 'Install']) {
      await expect(header(page).getByRole('link', { name, exact: true })).toBeVisible();
    }
    // Upright again: the menu stays closed until it is opened.
    await page.setViewportSize(PHONE);
    await expect(menuButton(page)).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await openMenu(page);
    await expect(menu(page).getByRole('menuitem')).toHaveCount(MENU.length);
  });

  test('S242-11 a session cookie that can’t be read shows the header as to a visitor, and the menu works', async ({
    page,
    context,
  }) => {
    const ref = new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').hostname.split('.')[0];
    await context.addCookies([
      {
        name: `sb-${ref}-auth-token`,
        value: `base64-${Buffer.from('not a session').toString('base64url')}`,
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/');
    await expect(signInLink(page)).toBeVisible();
    await expect(accountButton(page)).toHaveCount(0);
    await openMenu(page);
    expect(await menuItems(page)).toEqual(MENU.map(([name, href]) => [name, href]));
    await menu(page).getByRole('menuitem', { name: 'Install' }).click();
    await expect(page).toHaveURL(/\/install$/);
  });

  test('S242-12 with Supabase out of reach, a signed-in person’s header and menu still work', async ({
    page,
    context,
  }) => {
    await newAccount(page);
    await context.route(`${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/**`, (route) => route.abort());
    await page.goto('/');
    await expect(accountButton(page)).toBeVisible();
    await openMenu(page);
    expect(await menuItems(page)).toEqual(MENU.map(([name, href]) => [name, href]));
    await menu(page).getByRole('menuitem', { name: 'Install' }).click();
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeVisible();
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('S242-13 the footer still lists every page, and its links lead there', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await footerLinks(page)).toEqual(FOOTER.map(([name, href]) => [name, href]));
      for (const [name, path, title] of [
        ['Install', '/install', 'Install Xomoni'],
        ['Risks', '/risks', 'Before you start: the risks'],
        ['Terms', '/terms', 'Terms of Use'],
      ] as const) {
        await footerNav(page).getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      }
    });
  });

  test('S242-14 GitHub out of reach: Back returns to the page, whose menu opens again', async ({ page, context }) => {
    await context.route('https://github.com/**', (route) => route.abort('internetdisconnected'));
    await page.goto('/install');
    const failed = page.waitForEvent('requestfailed', (request) => request.url() === REPOSITORY);
    await (await openMenu(page)).getByRole('menuitem', { name: 'GitHub' }).click();
    await failed;
    await page.goBack();
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await openMenu(page);
    await expect(menu(page).getByRole('menuitem')).toHaveCount(MENU.length);
  });

  test('S242-15 a logo that fails to load still names Xomoni and leads home', async ({ page }) => {
    await page.route(
      (url) =>
        url.pathname === '/logo.png' ||
        (url.pathname === '/_next/image' && url.searchParams.get('url') === '/logo.png'),
      (route) => route.abort(),
    );
    await page.goto('/install');
    const logo = header(page).getByRole('link', { name: 'Xomoni', exact: true });
    await expect(logo).toBeVisible();
    await expect
      .poll(() => logo.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 0))
      .toBe(true);
    await logo.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: PUBLIC_PAGES[0][1] })).toBeVisible();
  });

  test('S242-16 GitHub opens in the same tab, with no hold on the page and only the site’s origin as referrer', async ({
    page,
    context,
    baseURL,
  }) => {
    const referrers = await playGithub(context);
    await page.goto('/install?from=newsletter');
    await (await openMenu(page)).getByRole('menuitem', { name: 'GitHub' }).click();
    await expect(page).toHaveURL(REPOSITORY);
    expect(context.pages()).toHaveLength(1);
    expect(await page.evaluate(() => window.opener === null)).toBe(true);
    expect(referrers).toEqual([`${new URL(baseURL ?? 'http://localhost:3000').origin}/`]);
  });

  test('S242-17 signed out, the menu and the footer lead only to public pages and to the project on GitHub', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(signInLink(page)).toHaveAttribute('href', '/login');
    await expect(accountButton(page)).toHaveCount(0);
    await openMenu(page);
    const links = [...(await menuItems(page)), ...(await footerLinks(page))].map(([, href]) => href ?? '');
    expect(links).toHaveLength(MENU.length + FOOTER.length);
    for (const href of links) {
      // /terms also covers /terms-of-sale, which the footer lists with /refunds while those pages are shown (#420).
      expect(href).toMatch(
        /^(\/(#how|#safety|#privacy|install|algorithm|risks|privacy|terms|refunds)|https:\/\/github\.com\/pirdehi\/)/,
      );
    }
    for (const name of ['Dashboard', 'Account', 'Sign out']) {
      await expect(menu(page).getByRole('menuitem', { name })).toHaveCount(0);
    }
  });

  test('S242-18 signed in, the menu and the footer are a visitor’s, and no link carries the person or the session', async ({
    page,
    context,
  }) => {
    const { email, userId } = await newAccount(page);
    await page.goto('/');
    await expect(accountButton(page)).toBeVisible();
    await openMenu(page);
    const menuLinks = await menuItems(page);
    expect(menuLinks).toEqual(MENU.map(([name, href]) => [name, href]));
    const links = await footerLinks(page);
    expect(links).toEqual(FOOTER.map(([name, href]) => [name, href]));
    const session = await refreshTokenOf(context);
    for (const [, href] of [...menuLinks, ...links]) {
      for (const secret of [email, encodeURIComponent(email), userId, session]) expect(href).not.toContain(secret);
    }
    for (const name of ['Dashboard', 'Account', 'Sign out']) {
      await expect(menu(page).getByRole('menuitem', { name })).toHaveCount(0);
    }
  });

  test('S242-19 a first visit: Sign in beside the menu, and opening and closing it stores nothing', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(signInLink(page)).toBeVisible();
    const stored = () =>
      page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    const cookies = async () => (await context.cookies()).map(({ name, value }) => `${name}=${value}`);
    const [before, cookiesBefore] = [await stored(), await cookies()];
    await openMenu(page);
    expect(await menuItems(page)).toEqual(MENU.map(([name, href]) => [name, href]));
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    expect(await stored()).toBe(before);
    expect(await cookies()).toEqual(cookiesBefore);
  });

  test('S242-20 a new account’s page on a phone has no menu, only the account’s, and the full footer', async ({
    page,
  }) => {
    await newAccount(page);
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(accountButton(page)).toBeVisible();
    await expect(menuButton(page)).toHaveCount(0);
    for (const [name] of MENU) await expect(header(page).getByRole('link', { name, exact: true })).toHaveCount(0);
    expect(await footerLinks(page)).toEqual(FOOTER.map(([name, href]) => [name, href]));
  });

  test('S242-21 a tap outside the menu closes it, and nothing is followed', async ({ page }) => {
    await page.goto('/');
    const url = page.url();
    await openMenu(page);
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.getByRole('heading', { level: 1 }).click();
    await expect(menu(page)).toBeHidden();
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  });

  test('S242-22 pressing Menu again closes it', async ({ page }) => {
    await page.goto('/');
    await openMenu(page);
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
    await menuButton(page).click();
    await expect(menu(page)).toBeHidden();
    await expect(menuButton(page)).not.toHaveAttribute('aria-expanded', 'true');
    await expect(page).toHaveURL(/\/$/);
  });

  test('S242-23 Tab out of the menu closes it and goes on to Sign in; Shift+Tab goes back to the logo', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(signInLink(page)).toBeVisible();
    await (await hydrated(menuButton(page))).focus();
    await page.keyboard.press('Enter');
    await expect(menu(page).getByRole('menuitem', { name: 'How it works' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu(page)).toBeHidden();
    await expect(signInLink(page)).toBeFocused();

    await menuButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(menu(page)).toBeHidden();
    await expect(header(page).getByRole('link', { name: 'Xomoni', exact: true })).toBeFocused();
  });

  test('S242-24 Escape on GitHub closes the menu without following it, back on the Menu button', async ({ page }) => {
    await page.goto('/');
    await (await hydrated(menuButton(page))).focus();
    await page.keyboard.press('Enter');
    await expect(menu(page).getByRole('menuitem', { name: 'How it works' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu(page).getByRole('menuitem', { name: 'GitHub' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });

  test('S242-25 with the keyboard alone: Tab to Menu, Space, the arrows round the items, Enter on Install', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(signInLink(page)).toBeVisible();
    await hydrated(menuButton(page));
    await page.keyboard.press('Tab');
    await expect(header(page).getByRole('link', { name: 'Xomoni', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menuButton(page)).toBeFocused();
    await page.keyboard.press('Space');
    const item = (name: string) => menu(page).getByRole('menuitem', { name });
    await expect(item('How it works')).toBeFocused();
    for (const name of ['Safety', 'Privacy', 'Install', 'GitHub', 'How it works']) {
      await page.keyboard.press('ArrowDown');
      await expect(item(name)).toBeFocused();
    }
    await page.keyboard.press('ArrowUp');
    await expect(item('GitHub')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(item('How it works')).toBeFocused();
    await page.keyboard.press('End');
    await expect(item('GitHub')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(item('Install')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeVisible();
  });

  test('S242-26 the button, the menu, its items and the two navigations have names, and the button says it is open', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(header(page).getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(footer(page).getByRole('navigation', { name: 'Site' })).toBeAttached();
    await expect(menuButton(page)).toHaveAttribute('aria-haspopup', 'menu');
    await expect(menuButton(page)).not.toHaveAttribute('aria-expanded', 'true');
    await openMenu(page);
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page)).toHaveAccessibleName('Menu');
    await expect(menu(page).getByRole('menuitem')).toHaveText(MENU.map(([name]) => name));
    for (const [name] of MENU) await expect(menu(page).getByRole('menuitem', { name })).toHaveAccessibleName(name);
  });

  test('S242-27 no serious accessibility violation with the menu open on each page, in light and dark', async ({
    page,
  }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const [path, title] of PUBLIC_PAGES.slice(1)) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
        await openMenu(page);
        await expectNoSeriousA11yViolations(page, { soft: true });
        await page.keyboard.press('Escape');
        await footer(page).scrollIntoViewIfNeeded();
        await expectNoSeriousA11yViolations(page, { soft: true });
      }
    }
  });

  test.describe('on an iPhone, by touch', () => {
    test.use({ userAgent: AGENTS.phone, hasTouch: true, isMobile: true });

    test('S242-28 a tap on Menu and one on Safety reach the section, with nothing wider than the screen', async ({
      page,
    }) => {
      await page.goto('/');
      await (await hydrated(menuButton(page))).tap();
      await expect(menu(page)).toBeVisible();
      await menu(page).getByRole('menuitem', { name: 'Safety' }).tap();
      await expect(page).toHaveURL(/\/#safety$/);
      await expect(menu(page)).toBeHidden();
      await expectSectionAtTop(page, 'safety');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });

  test('S242-29 the menu is there up to 767 px wide; from 768 px the header shows the links instead', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await page.goto('/');
    await expect(menuButton(page)).toBeVisible();
    for (const [name] of MENU) await expect(header(page).getByRole('link', { name, exact: true })).toBeHidden();
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(menuButton(page)).toBeHidden();
    for (const [name, href] of MENU) {
      await expect(header(page).getByRole('link', { name, exact: true })).toBeVisible();
      await expect(header(page).getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
  });

  test('S242-30 a reload with the menu open keeps the section and closes the menu', async ({ page }) => {
    await page.goto('/');
    await (await openMenu(page)).getByRole('menuitem', { name: 'Safety' }).click();
    await expectSectionAtTop(page, 'safety');
    await openMenu(page);
    await page.reload();
    await expect(page).toHaveURL(/\/#safety$/);
    await expect(menu(page)).toBeHidden();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Under your oversight, within each platform’s limits.' }),
    ).toBeInViewport();
    await openMenu(page);
    await expect(menu(page).getByRole('menuitem')).toHaveCount(MENU.length);
  });

  test('S242-31 Back after Install from the menu returns to the page with the menu closed, and Forward to Install', async ({
    page,
  }) => {
    await page.goto('/risks');
    await (await openMenu(page)).getByRole('menuitem', { name: 'Install' }).click();
    await expect(page).toHaveURL(/\/install$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/risks$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Before you start: the risks' })).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await expect(menuButton(page)).not.toHaveAttribute('aria-expanded', 'true');
    await page.goForward();
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeVisible();
  });
});
