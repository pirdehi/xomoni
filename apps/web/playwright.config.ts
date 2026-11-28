import { execSync } from 'node:child_process';
import path from 'node:path';
import { type Project, defineConfig, devices } from '@playwright/test';
import { TEST_EXTENSION_ID } from './e2e/support/fixed-id';
import { FAKE_POLAR_PORT, NO_REAL_POLAR } from './e2e/support/polar';
import { type BrowserName, browsersToTest } from './e2e/support/projects';

/**
 * End-to-end tests against the local Supabase stack (`supabase start`): real Supabase Auth, real emails
 * captured by Mailpit, Cloudflare's always-pass Turnstile key, and devices and jobs seeded as the extension
 * would report them.
 * The site must run on http://localhost:3000 because that is the local `site_url` in emails.
 */
const repoRoot = path.join(__dirname, '..', '..');

/** The fields of `supabase status -o json` the tests read. Older CLIs call Mailpit Inbucket. */
interface LocalStack {
  API_URL?: string;
  PUBLISHABLE_KEY?: string;
  SERVICE_ROLE_KEY?: string;
  MAILPIT_URL?: string;
  INBUCKET_URL?: string;
}
const status = JSON.parse(
  execSync('supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
) as LocalStack;

/** A value the local stack must report: the tests can't run without it. */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`\`supabase status\` reports no ${name}. Run \`supabase start\` first.`);
  return value;
}

const env = {
  NEXT_PUBLIC_SUPABASE_URL: required(status.API_URL, 'API_URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required(status.PUBLISHABLE_KEY, 'PUBLISHABLE_KEY'),
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  MAILPIT_URL: required(status.MAILPIT_URL ?? status.INBUCKET_URL, 'MAILPIT_URL'),
  // The test extension with a fixed key (e2e/fixed-id.spec.ts, #302): the site looks for Xomoni there too.
  NEXT_PUBLIC_XOMONI_TEST_EXTENSION_ID: TEST_EXTENSION_ID,
  // Lets a test choose the store listings /install shows (e2e/store-install.spec.ts, #304). Only this build reads them.
  NEXT_PUBLIC_E2E_STORE_LISTINGS: '1',
  // Polar is the fake of e2e/support/polar.ts, never the real one (#420): a test that pays starts it on this port.
  POLAR_API_URL: `http://127.0.0.1:${FAKE_POLAR_PORT}`,
};
process.env.MAILPIT_URL = env.MAILPIT_URL;
// For seeding devices and jobs (e2e/support/admin.ts): the local stack's fixed development keys.
process.env.SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = required(status.SERVICE_ROLE_KEY, 'SERVICE_ROLE_KEY');
process.env.SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** The extension's own tests: they need neither the site nor Supabase (playwright.extension.config.ts, #342). */
const EXTENSION = 'extension/**';
/** The release smoke test, on two releases' zips (playwright.release.config.ts, #419). */
const RELEASE = 'release/**';
/** The test of the fixed id, which loads a test extension. */
const FIXED_ID = 'fixed-id.spec.ts';

/**
 * Each browser the site is tested in (#342): Playwright's Chromium unless `XOMONI_E2E_BROWSERS` names others, such as
 * `msedge` in CI's `e2e-edge` job. fixed-id.spec.ts loads its test extension into Playwright's Chromium itself, as
 * Chrome and Edge no longer take --load-extension, so it runs with Chromium only.
 */
const PROJECTS: Record<BrowserName, Project> = {
  chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  msedge: {
    name: 'msedge',
    use: { ...devices['Desktop Edge'], channel: 'msedge' },
    testIgnore: [EXTENSION, RELEASE, FIXED_ID],
  },
  chrome: {
    name: 'chrome',
    use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    testIgnore: [EXTENSION, RELEASE, FIXED_ID],
  },
};

export default defineConfig({
  testDir: 'e2e',
  // A project's own testIgnore replaces this one, so each of Edge and Chrome lists it again.
  testIgnore: [EXTENSION, RELEASE],
  // Folders of its own: CI runs the extension's tests at the same time (#404), and each run empties its own folders.
  outputDir: 'test-results/website',
  // One worker: the flows share one Auth server and one inbox, and ordering keeps failures readable.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/website' }]]
    : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // No page reaches the real Polar (#420): the browser resolves none of its hosts.
    launchOptions: { args: [NO_REAL_POLAR] },
  },
  projects: browsersToTest().map((name) => PROJECTS[name]),
  webServer: {
    command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env,
  },
});
