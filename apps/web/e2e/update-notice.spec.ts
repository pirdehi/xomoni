import type { Page } from '@playwright/test';
import { createConfirmedUser, releasesOf } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Hear about new versions (docs/scenarios/151-update-notice.md, #151, #345), on xomoni.com's side: what its database
// answers a browser's status report about the newest release, from the releases it keeps (`extension_releases`).
// The local Supabase stack holds the releases its migrations record, the newest a security release. A browser connects with
// a one-time code from Browsers and reports with `device_report`, as Xomoni does. What the dashboard then shows is in
// e2e/extension/update-notice.spec.ts.

/**
 * The newest release the local stack records, read from its database before the tests (`releasesOf`), so a new
 * release's migration doesn't break them and the version reported is one the database itself gave. Each release since
 * 0.5.2 is a security fix.
 */
let NEWEST = '';

test.beforeAll(async () => {
  const versions = (await releasesOf()).map((r) => r.version);
  NEWEST = versions.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1) ?? '';
  expect(NEWEST, 'the local stack records releases').toMatch(/^\d+\.\d+\.\d+$/);
});

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** A new account with a browser connected by a one-time code from Browsers; returns the browser's token. */
async function connected(page: Page): Promise<string> {
  const email = uniqueEmail('releases');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  await page.goto('/dashboard/browsers');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get a code to connect a browser' }).click();
  const code = (await page.getByLabel('Pairing code').textContent()) ?? '';
  const paired = await asExtension('pair_device', { code, name: 'Chrome on macOS', version: '0.5.1' });
  expect(paired.status).toBe(200);
  return (paired.json as [{ token: string }])[0].token;
}

/** What a status report from `version` hears. */
const report = (token: string, version: string) => asExtension('device_report', { token, version, jobs: [] });

test.describe('hear about new versions: what xomoni.com answers', { tag: '@task-151' }, () => {
  test('S151-14 a browser on an older version hears of the newest, and that it fixes a security problem', async ({
    page,
  }) => {
    const token = await connected(page);
    const answer = await report(token, '0.5.1');
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ latest: NEWEST, security: true });
  });

  test('S151-15 a browser on the newest version hears it is the newest, with no security news', async ({ page }) => {
    const token = await connected(page);
    expect((await report(token, NEWEST)).json).toMatchObject({ latest: NEWEST, security: false });
  });

  test('S151-16 a version xomoni.com can’t read counts as older than every release', async ({ page }) => {
    const token = await connected(page);
    for (const version of ['dev', '', '0.5']) {
      expect((await report(token, version)).json, version).toMatchObject({ latest: NEWEST, security: true });
    }
  });

  test('S151-17 a version newer than every release, such as a build of the next one, hears no security news', async ({
    page,
  }) => {
    const token = await connected(page);
    expect((await report(token, '9.9.9')).json).toMatchObject({ latest: NEWEST, security: false });
  });

  test('S151-18 a report with a token xomoni.com doesn’t know is refused, with no news', async () => {
    const answer = await report('not-a-token-xomoni-made', '0.1.0');
    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ hint: 'unknown_device' });
    expect(answer.json).not.toHaveProperty('latest');
  });

  test('S151-19 the list of releases isn’t open to anyone: only a report hears the newest', async () => {
    const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/extension_releases?select=*`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' },
    });
    const rows = (await response.json().catch(() => null)) as unknown;
    expect(response.ok && Array.isArray(rows) && rows.length > 0).toBe(false);
  });

  test('S151-22 a report the database refuses carries no news, and changes nothing', async ({ page }) => {
    const token = await connected(page);
    const jobs = Array.from({ length: 51 }, (_, i) => ({
      local_id: `job-${String(i)}`,
      x_handle: 'ada_x',
      kind: 'scan',
      title: 'Complete my copy',
      state: 'running',
    }));
    const refused = await asExtension('device_report', { token, version: '0.5.1', jobs });
    expect(refused.status).toBe(400);
    expect(refused.json).not.toHaveProperty('latest');
    // The browser's next report is answered as before.
    expect((await report(token, '0.5.1')).json).toMatchObject({ latest: NEWEST, security: true });
  });
});
