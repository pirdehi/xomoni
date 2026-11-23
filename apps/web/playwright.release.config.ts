import { defineConfig } from '@playwright/test';
import { browsersToTest } from './e2e/support/projects';

/**
 * The release smoke test (#419, docs/RELEASING.md): the candidate's zip and the previous release's, both unpacked
 * (`XOMONI_E2E_EXTENSION` and `XOMONI_E2E_PREVIOUS`; `node tooling/release-download.mjs` fetches one from GitHub), in a
 * real browser with the extension harness (`e2e/support/extension.ts`): a clean install, an update in place, a
 * rollback and a move. A maintainer runs it before tagging, with `npm run test:e2e:release -w @xomoni/web`; it isn't
 * one of CI's checks, which build the extension from the pull request instead. Nothing is built here.
 */
export default defineConfig({
  testDir: 'e2e/release',
  globalSetup: './e2e/support/release-builds.ts',
  outputDir: 'test-results/release',
  // Two browsers in some tests, and an extension loaded three times in one.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/release' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: browsersToTest().map((name) => ({ name, use: { channel: name } })),
});
