import { expect, test as base } from '@playwright/test';
import { watchRealPolar } from './polar';

/**
 * Playwright's `test`, failing any test in which the browser blocked something on the site under its
 * Content-Security-Policy (#8). A page that needs a new origin must add it to the policy on purpose
 * (`src/shared/config/security-headers.ts`). Other origins' pages, such as Turnstile's frame, are ignored. It also
 * fails any test whose pages asked the real Polar for anything (#420): the browser resolves none of Polar's hosts
 * (`NO_REAL_POLAR`), so nothing leaves, and tests use the fake in `e2e/support/polar.ts`.
 */
export const test = base.extend<{ cspGuard: undefined; polarGuard: undefined }>({
  cspGuard: [
    async ({ page, baseURL }, use) => {
      const blocked: string[] = [];
      await page.exposeFunction('__xomoniCspViolation', (violation: string) => blocked.push(violation));
      await page.addInitScript(
        (origin) => {
          if (location.origin !== origin) return;
          document.addEventListener('securitypolicyviolation', (e) => {
            const report = (window as unknown as { __xomoniCspViolation(v: string): void }).__xomoniCspViolation;
            report(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline code'} on ${location.pathname}`);
          });
        },
        new URL(baseURL ?? 'http://localhost:3000').origin,
      );
      await use(undefined);
      expect(blocked, 'blocked by the Content-Security-Policy').toEqual([]);
    },
    { auto: true },
  ],
  polarGuard: [
    async ({ context }, use) => {
      const attempts = watchRealPolar(context);
      await use(undefined);
      expect(attempts, 'requests to the real Polar: use the fake in e2e/support/polar.ts').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
