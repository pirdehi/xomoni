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
