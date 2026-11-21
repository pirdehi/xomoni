/** The environment variable that names the browsers to test in, comma separated (#342). Unset, Playwright's Chromium. */
export const BROWSERS_ENV = 'XOMONI_E2E_BROWSERS';

/**
 * The browsers the end-to-end tests can run in: Playwright's Chromium, which it downloads, and Microsoft Edge and
 * Google Chrome as installed on the computer (`npx playwright install msedge`, or GitHub's runners, which have both).
 */
export const BROWSERS = ['chromium', 'msedge', 'chrome'] as const;

/** One of the browsers the tests can run in. */
export type BrowserName = (typeof BROWSERS)[number];

const isBrowser = (name: string): name is BrowserName => (BROWSERS as readonly string[]).includes(name);

/**
 * The browsers named by `XOMONI_E2E_BROWSERS` (`chromium,msedge`), in that order, or Chromium alone when it is unset;
 * each becomes a Playwright project of that name. A name that isn't one of `BROWSERS` fails the run.
 */
export function browsersToTest(value = process.env[BROWSERS_ENV]): BrowserName[] {
  const names = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names)
    if (!isBrowser(name)) throw new Error(`${BROWSERS_ENV} names ${name}; use any of ${BROWSERS.join(', ')}`);
  return names.length ? [...new Set(names as BrowserName[])] : ['chromium'];
}
