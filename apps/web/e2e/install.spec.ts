import { expect, test } from './support/test';

test.describe('install page (#44)', () => {
  test('the landing page’s install button leads to the guide, which downloads the latest release', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Get the extension' }).first().click();
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.getByRole('heading', { name: 'Install Xomoni' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute(
      'href',
      'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip',
    );
  });
});

test.describe('the header and footer (#242)', () => {
  test('on a computer, Install is in the header, and the footer links every page', async ({ page }) => {
    await page.goto('/');
    const header = page.getByRole('banner');
    await expect(header.getByRole('button', { name: 'Menu' })).toBeHidden();
    await header.getByRole('link', { name: 'Install' }).click();
    await expect(page).toHaveURL(/\/install$/);
    const footer = page.getByRole('navigation', { name: 'Site' });
    for (const name of ['Install', 'What’s new', 'Risks', 'Privacy', 'Terms', 'Security', 'Support', 'GitHub']) {
      await expect(footer.getByRole('link', { name })).toBeVisible();
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('every section and Install are one menu away, by keyboard too', async ({ page }) => {
      await page.goto('/');
      const header = page.getByRole('banner');
      await expect(header.getByRole('link', { name: 'Safety' })).toBeHidden();
      const menuButton = header.getByRole('button', { name: 'Menu' });
      await menuButton.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'How it works' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(menuButton).toBeFocused();

      for (const [name, url] of [
        ['How it works', /\/#how$/],
        ['Safety', /\/#safety$/],
        ['Privacy', /\/#privacy$/],
        ['Install', /\/install$/],
      ] as const) {
        await page.goto('/');
        await menuButton.click();
        await page.getByRole('menuitem', { name }).click();
        await expect(page).toHaveURL(url);
      }
      // Nothing is wider than the phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });
});

test.describe('getting started (#244)', () => {
  test('/welcome shows where a visitor stands, and sign-up comes back to it', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByRole('heading', { name: 'Welcome to Xomoni' })).toBeVisible();
    const steps = page.getByRole('region', { name: 'Getting started' });
    await expect(steps.getByRole('listitem')).toHaveCount(3);
    // No Xomoni answers in this test browser: the first step is to install it.
    await expect(steps.getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
    await page.getByRole('button', { name: 'Continue without an account' }).click();
    await expect(page.getByRole('status')).toHaveText('You can close this tab: Xomoni is ready on your computer.');

    await page.goto('/install');
    await expect(page.getByRole('region', { name: 'Getting started' })).toBeVisible();
  });
});
