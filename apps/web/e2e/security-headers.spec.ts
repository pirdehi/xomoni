import { signUpConfirmed, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Every test here also fails on anything the Content-Security-Policy blocks (see `support/test.ts`).
test.describe('security headers (#8)', () => {
  test('come with every page, private pages and static files included', async ({ request }) => {
    for (const path of ['/', '/login', '/signup', '/forgot-password', '/risks', '/dashboard', '/robots.txt']) {
      const headers = (await request.get(path)).headers();
      expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
      expect(headers['x-frame-options'], path).toBe('DENY');
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
      expect(headers['permissions-policy'], path).toContain('camera=()');
      expect(headers['cross-origin-opener-policy'], path).toBe('same-origin');
    }
  });

  test('let the auth forms load the Turnstile check', async ({ page }) => {
    for (const [path, button] of [
      ['/login', 'Sign in'],
      ['/signup', 'Create account'],
      ['/forgot-password', 'Send reset link'],
    ] as const) {
      await page.goto(path);
      // The button turns on only once Turnstile's script and frame have produced a token.
      await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled({ timeout: 30_000 });
    }
  });

  test('keep sign-up and the live dashboard working', async ({ page }) => {
    await signUpConfirmed(page, uniqueEmail('csp'));
    // "Live" means the Realtime WebSocket to Supabase connected.
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
  });

  test('stop other sites from framing the site', async ({ page, baseURL }) => {
    await page.setContent(`<iframe src="${baseURL}/login" title="framed"></iframe>`);
    await expect.poll(() => page.frames()[1]?.url()).toBe('chrome-error://chromewebdata/');
    expect(await page.frameLocator('iframe').getByRole('button', { name: 'Sign in' }).count()).toBe(0);
  });
});
