import { expect, test as base } from '@playwright/test';

/**
 * Playwright's `test`, failing any test in which the browser blocked something on the site under its
 * Content-Security-Policy (#8). A page that needs a new origin must add it to the policy on purpose
 * (`src/shared/config/security-headers.ts`). Other origins' pages, such as Turnstile's frame, are ignored.
 */
export const test = base.extend<{ cspGuard: undefined }>({
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
});

export { expect };
