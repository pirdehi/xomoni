import { expectDashboard, signUpConfirmed, uniqueEmail } from './support/flows';
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
      // #147
      expect(headers['cross-origin-resource-policy'], path).toBe('same-origin');
      expect(headers['reporting-endpoints'], path).toBe('csp="/api/csp-report"');
      expect(headers['content-security-policy'], path).toContain('report-to csp');
      expect(headers['content-security-policy'], path).toContain('report-uri /api/csp-report');
      // `next dev` needs eval, so only the production build (CI) enforces Trusted Types.
      if (process.env.CI) {
        expect(headers['content-security-policy'], path).toContain("require-trusted-types-for 'script'");
        expect(headers['content-security-policy'], path).toContain('trusted-types default');
      }
    }
  });

  test('let mail apps load the logo the auth emails show (#147)', async ({ request }) => {
    const logo = await request.get('/logo.png');
    expect(logo.status()).toBe(200);
    expect(logo.headers()['cross-origin-resource-policy']).toBe('cross-origin');
  });

  test('load every public page and move between them in the app without a violation (#147)', async ({ page }) => {
    for (const path of ['/', '/login', '/signup', '/forgot-password', '/risks', '/privacy', '/terms']) {
      expect((await page.goto(path))?.status(), path).toBe(200);
    }
    // Client-side navigation loads more bundles through `script.src`, which Trusted Types guards.
    await page.goto('/');
    for (const path of ['/risks', '/privacy', '/terms']) {
      await page.locator(`a[href="${path}"]:visible`).first().click();
      await expect(page).toHaveURL(`http://localhost:3000${path}`);
      await page.goBack();
      await expect(page).toHaveURL('http://localhost:3000/');
    }
  });

  test('show the sign-in form when an extension made a default Trusted Types policy first (#178)', async ({ page }) => {
    // What some browser extensions do at document_start, before the site's own scripts.
    await page.addInitScript(() => {
      type Rules = Record<string, (value: string) => string>;
      const host = window as unknown as { trustedTypes?: { createPolicy(name: string, rules: Rules): unknown } };
      host.trustedTypes?.createPolicy('default', { createHTML: (value) => value, createScriptURL: (value) => value });
    });
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('refuse a sign-out posted by another site, and keep the session (#147)', async ({ page }) => {
    await signUpConfirmed(page, uniqueEmail('csrf'));
    const forgeries: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, {}];
    for (const headers of forgeries) {
      const forged = await page.request.post('/auth/signout?scope=everywhere', { maxRedirects: 0, headers });
      expect(forged.status(), JSON.stringify(headers)).toBe(403);
    }
    await page.goto('/dashboard');
    await expectDashboard(page);
  });

  test('take violation reports, and refuse oversized or malformed ones (#147)', async ({ request }) => {
    const report = [
      {
        type: 'csp-violation',
        url: 'http://localhost:3000/',
        body: { documentURL: 'http://localhost:3000/', effectiveDirective: 'img-src', blockedURL: 'https://x.test/a' },
      },
    ];
    const reports = { 'content-type': 'application/reports+json' };
    expect((await request.post('/api/csp-report', { headers: reports, data: JSON.stringify(report) })).status()).toBe(
      204,
    );
    expect((await request.post('/api/csp-report', { headers: reports, data: 'x'.repeat(64 * 1024) })).status()).toBe(
      413,
    );
    expect((await request.post('/api/csp-report', { headers: reports, data: '{oops' })).status()).toBe(400);
    expect(
      (await request.post('/api/csp-report', { headers: { 'content-type': 'text/plain' }, data: '{}' })).status(),
    ).toBe(415);
    expect((await request.get('/api/csp-report')).status()).toBe(405);
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
