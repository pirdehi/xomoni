import { defineConfig } from '@playwright/test';
import { browsersToTest } from './e2e/support/projects';

/**
 * The extension in a real browser (#342, ADR-0040): the built Xomoni, its dashboard and its content script on x.com
 * pages served from synthetic fixtures. No Supabase, no website and no network: each test launches its own browser
 * (`e2e/support/extension.ts`), and the global setup builds the extension once per run. Playwright's Chromium unless
 * `XOMONI_E2E_BROWSERS` names others (`msedge`, `chrome`). The website's tests are in playwright.config.ts.
 */
export default defineConfig({
  testDir: 'e2e/extension',
  globalSetup: './e2e/support/build-extension.ts',
  // Beside the website's run's (`test-results/website`): CI runs both at once (#404), and each empties its own.
  outputDir: 'test-results/extension',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/extension' }]]
    : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: browsersToTest().map((name) => ({ name, use: { channel: name } })),
});
