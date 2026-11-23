import type { BrowserContext, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Private by design (docs/scenarios/143-private-by-design.md, ADR-0004, ADR-0028, #143, #149, #233, #345), on xomoni.com: no tracking,
// only job status (and daily counts, by choice) stored, and what Xomoni shows from the same browser kept in the page.
// The local Supabase stack, with its real Auth and database. The extension's half is in
// e2e/extension/private-by-design.spec.ts.

/** The extension id the site is handed in the page's address, as Xomoni's own links do (ADR-0025). */
const EXT = 'abcdefghijklmnopabcdefghijklmnop';

/** Words only Xomoni keeps: a post's text. They must never reach a server or the site's storage. */
const SECRET_POST = 'A post only Xomoni keeps 4e7c';

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** The rows of `table` that belong to `userId`, as the database holds them, read with the local stack's service key. */
async function rowsOf(table: 'jobs' | 'devices', userId: string): Promise<Record<string, unknown>[]> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/${table}?user_id=eq.${userId}&select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return (await response.json()) as Record<string, unknown>[];
}

/** The origins the site's own pages may talk to: the site itself, and its Supabase project. */
const OWN_ORIGINS = () =>
  new Set([new URL('http://localhost:3000').origin, new URL(process.env.SUPABASE_URL ?? '').origin]);

/** The origins of every request `context` sends from now on. */
function origins(context: BrowserContext): Set<string> {
  const seen = new Set<string>();
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') || url.protocol.startsWith('ws')) seen.add(url.origin.replace(/^ws/, 'http'));
  });
  return seen;
}

/**
 * Plays Xomoni in this browser, as Chrome does for an extension that lists xomoni.com in `externally_connectable`: the
 * one sign-in (hello, then a sign-in that trades the code with `pair_device`) and the Library read of ADR-0028, which
 * answers with one post only Xomoni keeps.
 */
async function installFakeXomoni(page: Page) {
  const state: { deviceId: string | null; refuse: string | null } = { deviceId: null, refuse: null };
  const received: Record<string, unknown>[] = [];
  await page.exposeFunction('xomoniFakeExtension', async (id: string, message: Record<string, unknown>) => {
    if (id !== EXT) return undefined;
    received.push(message);
    switch (message.type) {
      case 'xomoni-hello':
        return {
          ok: true,
          state: {
            version: '0.5.2',
            connection: state.deviceId && { deviceId: state.deviceId, account: 'x', connectedAt: 1 },
            signedOutAt: null,
            leftAt: 0,
          },
        };
      case 'xomoni-sign-in': {
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.5.2',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, account }] = paired.json as [{ device_id: string; account: string }];
        state.deviceId = device_id;
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-read':
        if (message.deviceId !== state.deviceId) return { ok: false, reason: 'other_account' };
        if (state.refuse) return { ok: false, reason: state.refuse };
        if (message.what !== 'library') return { ok: false, reason: 'invalid' };
        return {
          ok: true,
          what: 'library',
          page: {
            handle: 'ada',
            counts: {
              post: { present: 1, removed: 0 },
              reply: { present: 0, removed: 0 },
              repost: { present: 0, removed: 0 },
              like: { present: 0, removed: 0 },
            },
            matching: message.kind === 'post' ? 1 : 0,
            items:
              message.kind === 'post'
                ? [
                    {
                      kind: 'post',
                      id: '1800000000000000001',
                      author: 'ada',
                      text: SECRET_POST,
                      createdAt: Date.UTC(2024, 0, 2),
                      likes: 3,
                      reposts: 0,
                      replies: 0,
                      removed: false,
                    },
                  ]
                : [],
            next: null,
          },
        };
      default:
        return { ok: false, reason: 'invalid' };
    }
  });
  await page.addInitScript(() => {
    const send = (window as unknown as { xomoniFakeExtension: (id: string, m: unknown) => Promise<unknown> })
      .xomoniFakeExtension;
    const runtime = {
      sendMessage: (id: string, message: unknown, callback: (answer: unknown) => void) => {
        void send(id, message).then(callback);
      },
    };
    Object.defineProperty(window, 'chrome', { value: { runtime }, configurable: true });
  });
  return { state, received };
}

test.describe('private by design: xomoni.com', { tag: '@task-143' }, () => {
  test('S143-11 before anyone signs in, xomoni.com sets no cookie and loads nothing from another site', async ({
    page,
    context,
  }) => {
    const seen = origins(context);
    for (const path of ['/', '/install', '/privacy', '/risks']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
    }
    expect([...seen].filter((origin) => !OWN_ORIGINS().has(origin))).toEqual([]);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test('S143-12 signed in, the dashboard talks only to xomoni.com and its database, with a session cookie only', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail('private');
    await createConfirmedUser(email, PASSWORD);
    const seen = origins(context);
    await page.goto('/login');
    // The sign-in form's bot check comes from Cloudflare: the one other site, and only on the forms.
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    seen.clear();
    for (const place of ['activity', 'audience', 'reports', 'browsers']) {
      await page.goto(`/dashboard/${place}`);
      await expect(page.getByText('Live', { exact: true })).toBeVisible();
    }
    expect([...seen].filter((origin) => !OWN_ORIGINS().has(origin))).toEqual([]);
    const cookies = (await context.cookies()).map((c) => c.name);
    expect(cookies.length).toBeGreaterThan(0);
    for (const name of cookies) expect(name).toMatch(/^sb-[\w-]+-auth-token(\.\d+)?$/);
  });

  test('S143-13 the privacy page says what stays on the computer and what xomoni.com keeps', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(
      'Your X password, session cookies, posts, replies, likes, archive and activity log never leave your computer.',
    );
    await expect(page.getByRole('main')).toContainText(
      'An account is optional. Without one, nothing is sent to us at all.',
    );
    await expect(page.getByRole('main')).toContainText('No ads, no selling of data, no tracking or analytics cookies.');
    await expect(page.getByRole('heading', { name: 'What stays on your computer' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'What xomoni.com shows from the extension in the same browser' }),
    ).toBeVisible();
  });

  test('S143-14 X content slipped into a job report is dropped: the database has no place for it', async ({ page }) => {
    const email = uniqueEmail('private-report');
    const userId = await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await page.goto('/dashboard/browsers');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Get a code to connect a browser' }).click();
    const code = (await page.getByLabel('Pairing code').textContent()) ?? '';
    const paired = await asExtension('pair_device', { code, name: 'Chrome on macOS', version: '0.5.2' });
    const [{ token }] = paired.json as [{ token: string }];

    const report = await asExtension('device_report', {
      token,
      version: '0.5.2',
      jobs: [
        {
          local_id: 'job-1',
          x_handle: 'ada_x',
          kind: 'cleanup',
          title: 'Delete posts older than Jan 1, 2021',
          state: 'running',
          phase: 'Searching X',
          state_reason: SECRET_POST,
          matched: 2,
          done: 1,
          // Fields a careless client might add: the database keeps none of them.
          text: SECRET_POST,
          tweet_id: '1800000000000000001',
          likes: ['1800000000000000002'],
        },
      ],
    });
    expect(report.status).toBe(200);
    await page.goto('/dashboard/activity');
    await expect(page.getByRole('region', { name: 'Jobs' })).toContainText('Delete posts older than Jan 1, 2021');
    await expect(page.getByText(SECRET_POST)).toHaveCount(0);

    // The row as the database holds it: status columns only.
    const rows = await rowsOf('jobs', userId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ title: 'Delete posts older than Jan 1, 2021', state_reason: '', matched: 2, done: 1 });
    for (const field of ['text', 'tweet_id', 'likes']) expect(row).not.toHaveProperty(field);
    expect(JSON.stringify(row)).not.toContain(SECRET_POST);
    expect(JSON.stringify(row)).not.toContain('1800000000000000001');
  });

  test('S143-15 the Library on xomoni.com comes from Xomoni in this browser, and never reaches a server or storage', async ({
    page,
  }) => {
    const email = uniqueEmail('private-library');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    const sent: string[] = [];
    page.on('request', (request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    await page.goto(`/#ext=${EXT}`);
    // A page the extension opened: once the site has kept the id, it clears it from the address. Signing in before
    // that leaves the site without the id, so it never signs Xomoni in (slower browsers, such as Edge on CI).
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.deviceId).toBeTruthy();

    await page.goto('/dashboard/library');
    await expect(page.getByRole('list', { name: 'Posts' })).toContainText(SECRET_POST);
    expect(sent.filter((line) => line.includes(SECRET_POST) || line.includes(encodeURIComponent(SECRET_POST)))).toEqual(
      [],
    );
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage]
        .flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`))
        .join('\n'),
    );
    expect(stored).not.toContain(SECRET_POST);

    // Kept only while the page is open: a new page asks Xomoni again.
    const reads = fake.received.filter((m) => m.type === 'xomoni-read').length;
    await page.reload();
    await expect(page.getByRole('list', { name: 'Posts' })).toContainText(SECRET_POST);
    expect(fake.received.filter((m) => m.type === 'xomoni-read').length).toBeGreaterThan(reads);
  });

  test('S143-16 the privacy page has headings to move by, and no serious accessibility violation', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(3);
    await expectNoSeriousA11yViolations(page);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('S143-22 on a phone, the privacy page reads with nothing to scroll sideways', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
      const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: innerWidth }));
      expect(widths.page).toBeLessThanOrEqual(widths.screen);
      await expect(page.getByText('An account is optional. Without one, nothing is sent to us at all.')).toBeInViewport(
        {
          ratio: 0,
        },
      );
    });
  });

  test('S143-23 deleting the account deletes its browsers and job history from xomoni.com', async ({ page }) => {
    const email = uniqueEmail('private-delete');
    const userId = await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await page.goto('/dashboard/browsers');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Get a code to connect a browser' }).click();
    const code = (await page.getByLabel('Pairing code').textContent()) ?? '';
    const paired = await asExtension('pair_device', { code, name: 'Chrome on macOS', version: '0.5.2' });
    const [{ token }] = paired.json as [{ token: string }];
    await asExtension('device_report', {
      token,
      version: '0.5.2',
      jobs: [{ local_id: 'job-1', x_handle: 'ada_x', kind: 'scan', title: 'Complete my copy', state: 'running' }],
    });
    expect(await rowsOf('jobs', userId)).toHaveLength(1);

    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete my Xomoni account' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete your Xomoni account?' });
    await expect(confirm).toContainText('connected browsers and job history on this site. Nothing on X is deleted');
    await confirm.getByLabel('Type DELETE to confirm').fill('DELETE');
    await confirm.getByRole('button', { name: 'Delete account' }).click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);

    expect(await rowsOf('jobs', userId)).toEqual([]);
    expect(await rowsOf('devices', userId)).toEqual([]);
    // The browser's token is gone with them.
    expect((await asExtension('device_report', { token, version: '0.5.2', jobs: [] })).status).toBe(400);
  });

  test('S143-24 without Xomoni in this browser, the Library says where it lives, and no server is asked for it', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail('private-nothere');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    const seen = origins(context);
    await page.goto('/dashboard/library');
    await expect(
      page.getByText(
        'Your Library is read from Xomoni on your computer, in this browser: it never reaches our servers. Open this page in the browser where Xomoni runs, signed in to this account.',
      ),
    ).toBeVisible();
    expect([...seen].filter((origin) => !OWN_ORIGINS().has(origin))).toEqual([]);
  });

  test('S143-25 when Xomoni here refuses the read, the page shows none of the copy, and keeps none', async ({
    page,
  }) => {
    const email = uniqueEmail('private-refused');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    await page.goto(`/#ext=${EXT}`);
    // A page the extension opened: once the site has kept the id, it clears it from the address. Signing in before
    // that leaves the site without the id, so it never signs Xomoni in (slower browsers, such as Edge on CI).
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.deviceId).toBeTruthy();
    // The person signed out of Xomoni in this browser since.
    fake.state.refuse = 'signed_out';

    await page.goto('/dashboard/library');
    await expect(page.getByText('Xomoni didn’t answer. Open it on this computer and try again.')).toBeVisible();
    await expect(page.getByText(SECRET_POST)).toHaveCount(0);
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage]
        .flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`))
        .join('\n'),
    );
    expect(stored).not.toContain(SECRET_POST);
  });
});
