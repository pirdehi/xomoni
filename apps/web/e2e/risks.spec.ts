import { expect, test } from './support/test';

test.describe('risks page (#24)', () => {
  test('shows the informed-consent text, with X’s rule and what Xomoni never does', async ({ page }) => {
    await page.goto('/risks');
    await expect(page.getByRole('heading', { level: 1, name: 'Before you start: the risks' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deletions are permanent' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read X’s automation rules' })).toHaveAttribute(
      'href',
      'https://help.x.com/en/rules-and-policies/x-automation',
    );
    await expect(page.getByText('Ask for, store or read your X password or cookies.')).toBeVisible();
  });

  test('is linked from the footer', async ({ page }) => {
    await page.goto('/terms');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Risks' }).click();
    await expect(page).toHaveURL(/\/risks$/);
  });
});
