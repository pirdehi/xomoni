import { execSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

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
};
process.env.MAILPIT_URL = env.MAILPIT_URL;
// For seeding devices and jobs (e2e/support/admin.ts): the local stack's fixed development keys.
process.env.SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = required(status.SERVICE_ROLE_KEY, 'SERVICE_ROLE_KEY');
process.env.SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export default defineConfig({
  testDir: 'e2e',
  // One worker: the flows share one Auth server and one inbox, and ordering keeps failures readable.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env,
  },
});
