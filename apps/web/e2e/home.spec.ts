import type { Page } from '@playwright/test';
import { AGENTS, CHROME_STORE, EDGE_STORE, asBrowser, listIn } from './support/browsers';
import { expect, test } from './support/test';

/** The page's width beyond the window's, if anything on it is wider than the window. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The content of a `<meta>` tag, by `name` or `property`. */
const meta = (page: Page, key: string) =>
  page.locator(`meta[name="${key}"], meta[property="${key}"]`).first().getAttribute('content');

test.describe('the home page: a digital footprint manager (#313)', () => {
  test('names Xomoni, its title and description, and shares them as the page’s own', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Xomoni — Digital footprint manager');
    expect(await meta(page, 'description')).toContain('Manage your digital footprint from your own computer');
    expect(await meta(page, 'og:title')).toBe('Xomoni — Digital footprint manager');
    expect(await meta(page, 'og:description')).toContain('starting with X');
    expect(await meta(page, 'og:image')).toBe('https://xomoni.com/screens/overview.png');

    // Another page keeps its own title for sharing, not the home page's.
    await page.goto('/risks');
    await expect(page).toHaveTitle('Risks · Xomoni');
    expect(await meta(page, 'og:title')).toBe('Risks · Xomoni');
  });

  test('tells what Xomoni does and where, with X the only place today', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Manage your digital footprint, starting with X.' }),
    ).toBeVisible();

    const pillars = page.getByRole('list', { name: 'The five things Xomoni does' });
    await expect(pillars.getByRole('heading', { level: 3 })).toHaveText([
      'Discover',
      'Understand',
      'Clean up',
      'Protect',
      'Shape',
    ]);
    await expect(pillars.getByText('On X today')).toHaveCount(5);

    const places = page.getByRole('list', { name: 'Places' }).getByRole('listitem');
    await expect(places).toHaveCount(3);
    await expect(places.nth(0)).toContainText('Today');
    await expect(places.nth(0)).toContainText('X');
    await expect(places.nth(1)).toContainText('Next');
    await expect(places.nth(1)).toContainText('not available yet');
    await expect(places.nth(2)).toContainText('Later');
    await expect(page.getByRole('main')).toContainText('not affiliated with, endorsed by or sponsored by X Corp.');
  });

  test('says near the top that acting on X carries a risk, one click from the risks page', async ({ page }) => {
    await page.goto('/');
    const risk = page.getByRole('note', { name: 'The risk' });
    await expect(risk).toContainText('X’s rules forbid automating its website');
    await risk.getByRole('link', { name: 'Read the risks' }).click();
    await expect(page).toHaveURL(/\/risks$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Before you start: the risks' })).toBeVisible();
  });

  test.describe('its install buttons (#304)', () => {
    test.use({ userAgent: AGENTS.edge });

    test('lead to /install with today’s words while no store lists Xomoni', async ({ page }) => {
      await asBrowser(page, 'edge');
      await page.goto('/');
      const installs = page.getByRole('main').getByRole('link', { name: 'Get the extension' });
      await expect(installs).toHaveCount(2);
      for (const install of await installs.all()) await expect(install).toHaveAttribute('href', '/install');
      await expect(page.getByRole('main')).toContainText('Chrome Web Store listing coming soon.');
      await installs.last().click();
      await expect(page).toHaveURL(/\/install$/);
    });

    test('are the store’s own button for the visitor’s browser once a store lists Xomoni', async ({ page }) => {
      await asBrowser(page, 'edge');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/');
      const adds = page.getByRole('main').getByRole('link', { name: 'Get it for Edge' });
      await expect(adds).toHaveCount(2);
      for (const add of await adds.all()) await expect(add).toHaveAttribute('href', EDGE_STORE);
      await expect(page.getByRole('main').getByRole('link', { name: 'Get the extension' })).toHaveCount(0);
      await expect(page.getByRole('main')).toContainText('from the Chrome Web Store or Edge Add-ons.');
    });
  });

  test('shows the whole dashboard on a computer', async ({ page }) => {
    await page.goto('/');
    const shot = page.getByRole('img', { name: /^Xomoni’s Home for an X account/ });
    await expect(shot).toBeVisible();
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain('overview.png');
    const box = (await shot.boundingBox())!;
    expect(box.height / box.width).toBeCloseTo(1000 / 1440, 1);
  });

  test.describe('on a phone, in dark mode', () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });

    test('fits the screen, keeps the install path, and shows the dark dashboard', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const install = page.getByRole('main').getByRole('link', { name: 'Get the extension' }).first();
      await expect(install).toBeVisible();
      await expect(page.getByRole('list', { name: 'Places' }).getByRole('listitem')).toHaveCount(3);
      // Nothing is wider than the phone.
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      // The narrow part of the dashboard (#243), which reads at a phone's width, in its own proportions.
      const shot = page.getByRole('img', { name: /^Xomoni’s Home for an X account/ });
      await expect(shot).toBeVisible();
      await expect
        .poll(() => shot.evaluate((img: HTMLImageElement) => img.currentSrc))
        .toContain('overview-narrow-dark');
      const box = (await shot.boundingBox())!;
      expect(box.height / box.width).toBeCloseTo(1160 / 920, 1);

      await install.click();
      await expect(page).toHaveURL(/\/install$/);
    });
  });
});
