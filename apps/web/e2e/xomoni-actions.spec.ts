import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/**
 * Plays Xomoni in this browser, as Chrome does for an extension that lists xomoni.com in `externally_connectable`:
 * the one sign-in (hello and sign-in, trading the code with `pair_device`) and the actions of ADR-0027, which it
 * records and answers as the extension would. One running job is reported as soon as it signs in.
 */
async function installFakeXomoni(page: Page) {
  const state: { connection: { deviceId: string; token: string; account: string } | null } = { connection: null };
  let settings = {
    preset: 'custom',
    pace: Object.fromEntries(
      ['delete', 'unretweet', 'unlike', 'relike', 'read'].map((a) => [a, { perHour: 5, perDay: 50 }]),
    ),
    activeHours: { enabled: true, start: 8, end: 23 },
    notifications: true,
    whileAway: true,
    maxFailures: 2,
    handle: 'ada',
    watch: ['xomoni', ''],
  };
  const received: Record<string, unknown>[] = [];
  await page.exposeFunction('xomoniFakeExtension', async (id: string, message: Record<string, unknown>) => {
    if (id !== EXT) return undefined;
    received.push(message);
    switch (message.type) {
      case 'xomoni-hello':
        return {
          ok: true,
          state: {
            version: '0.3.0',
            connection: state.connection && {
              deviceId: state.connection.deviceId,
              account: state.connection.account,
              connectedAt: 1,
            },
            signedOutAt: null,
            leftAt: 0,
          },
        };
      case 'xomoni-sign-in': {
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.3.0',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, token, account }] = paired.json as [{ device_id: string; token: string; account: string }];
        state.connection = { deviceId: device_id, token, account };
        await asExtension('device_report', {
          token,
          version: '0.3.0',
          jobs: [
            {
              local_id: 'local-job-1',
              x_handle: 'ada',
              kind: 'cleanup',
              title: 'Delete posts before 2019',
              state: 'running',
              phase: 'sweep',
              state_reason: '',
              matched: 90,
              done: 40,
              skipped: 0,
              failed: 0,
              scanned: 0,
              risk_level: 0,
              started_at: new Date().toISOString(),
              finished_at: null,
            },
          ],
        });
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-job':
        return message.deviceId === state.connection?.deviceId
          ? { ok: true, outcome: 'stopping' }
          : { ok: false, reason: 'other_account' };
      case 'xomoni-open':
        return { ok: true, outcome: 'opened' };
      case 'xomoni-read':
        if (message.deviceId !== state.connection?.deviceId) return { ok: false, reason: 'other_account' };
        if (message.what === 'cleanup')
          return { ok: true, what: 'cleanup', estimate: { handle: 'ada', matching: 1234, archive: true, perDay: 100 } };
        return message.what === 'settings' ? { ok: true, what: 'settings', settings } : readAnswer(message);
      case 'xomoni-plan':
        return message.deviceId === state.connection?.deviceId
          ? { ok: true, outcome: 'opened' }
          : { ok: false, reason: 'other_account' };
      case 'xomoni-settings': {
        if (message.deviceId !== state.connection?.deviceId) return { ok: false, reason: 'other_account' };
        // Xomoni applies its own rules; here a change is simply taken as it came.
        settings = { ...settings, ...(message.change as Partial<typeof settings>) };
        return { ok: true, settings };
      }
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

/** Words only Xomoni knows: they must never reach a server or the site's storage (ADR-0028). */
const SECRET_POST = 'A post only Xomoni keeps 7f3a';
const SECRET_SEARCH = 'search only Xomoni keeps 9c1d';
const SECRET_REPLY = 'A reply only Xomoni keeps 2b8e';
const SECRET_INCOMING = 'Someone else’s reply only Xomoni keeps 5d1a';

/** Xomoni's answer to a read, as the extension builds it from its own database (#233). */
function readAnswer(message: Record<string, unknown>) {
  switch (message.what) {
    case 'library':
      return {
        ok: true,
        what: 'library',
        page: {
          handle: 'ada',
          counts: {
            post: { present: 2, removed: 1 },
            reply: { present: 0, removed: 0 },
            repost: { present: 0, removed: 0 },
            like: { present: 0, removed: 0 },
          },
          matching: message.kind === 'post' ? 2 : 0,
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
                    reposts: 1,
                    replies: 0,
                    removed: false,
                  },
                  {
                    kind: 'post',
                    id: '1800000000000000000',
                    author: 'ada',
                    text: 'An older post',
                    createdAt: Date.UTC(2023, 5, 1),
                    likes: 0,
                    reposts: 0,
                    replies: 0,
                    removed: true,
                  },
                ]
              : [],
          next: null,
        },
      };
    case 'replies': {
      const filter = message.filter as { replyTo: string };
      const replies = [
        {
          id: '1800000000000000011',
          replyTo: 'bob',
          text: SECRET_REPLY,
          createdAt: Date.UTC(2024, 0, 3),
          likes: 0,
          reposts: 0,
          replies: 0,
          thread: false,
        },
        {
          id: '1800000000000000010',
          replyTo: 'carol',
          text: 'Another reply',
          createdAt: Date.UTC(2023, 0, 3),
          likes: 2,
          reposts: 0,
          replies: 1,
          thread: false,
        },
      ].filter((r) => !filter.replyTo || r.replyTo === filter.replyTo);
      return {
        ok: true,
        what: 'replies',
        page: {
          handle: 'ada',
          total: 2,
          matching: replies.length,
          items: replies,
          next: null,
          people: [
            { handle: 'bob', replies: 1 },
            { handle: 'carol', replies: 1 },
          ],
        },
      };
    }
    case 'incoming':
      return {
        ok: true,
        what: 'incoming',
        page: {
          handle: 'ada',
          total: 1,
          since: Date.now() - 86_400_000,
          perDay: [{ day: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), replies: 1 }],
          people: [{ handle: 'carol', replies: 1 }],
          matching: 1,
          items: [
            {
              id: '1800000000000000031',
              author: 'carol',
              text: SECRET_INCOMING,
              createdAt: Date.now() - 86_400_000,
              toId: '1800000000000000001',
            },
          ],
          next: null,
        },
      };
    case 'health':
      return {
        ok: true,
        what: 'health',
        accounts: [
          {
            handle: 'ada',
            level: 1,
            reason: 'X answered slowly',
            pace: 0.5,
            reducedUntil: null,
            resumeAt: null,
            fullStop: false,
          },
        ],
      };
    case 'watch':
      return {
        ok: true,
        what: 'watch',
        tabs: [
          {
            query: SECRET_SEARCH,
            checkedAt: Date.now() - 60_000,
            error: '',
            posts: [{ id: '42', handle: 'grace', name: 'Grace', text: 'Found by the search', time: Date.now() }],
          },
        ],
      };
    default:
      return { ok: false, reason: 'invalid' };
  }
}

test.describe('Xomoni’s actions on xomoni.com (#251, ADR-0027)', () => {
  test('without Xomoni in this browser, an action opens the “not installed” dialog', async ({ page }) => {
    const email = uniqueEmail('actions-none');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);

    await page.goto('/dashboard/library');
    await page.getByRole('button', { name: 'Open in Xomoni' }).click();

    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Install Xomoni/ })).toHaveAttribute('href', '/install');
    await expectNoSeriousA11yViolations(page);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('with Xomoni here, Pause goes to it by the job’s id there, and its answer shows', async ({ page }) => {
    const email = uniqueEmail('actions-here');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    // A page the extension opened: the site keeps its id and clears it from the address bar.
    await page.goto(`/#ext=${EXT}`);
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();

    await page.goto('/dashboard/activity');
    const job = page.getByRole('region', { name: 'Jobs' }).getByRole('listitem').first();
    await expect(job).toContainText('Delete posts before 2019');
    await job.getByRole('button', { name: 'Pause' }).click();

    await expect(page.getByText('Pausing: the job stops after the action in progress.')).toBeVisible();
    expect(fake.received.filter((m) => m.type === 'xomoni-job')).toEqual([
      { type: 'xomoni-job', action: 'pause', deviceId: fake.state.connection?.deviceId, jobId: 'local-job-1' },
    ]);
  });
});

test.describe('Xomoni’s places on xomoni.com, read in this browser (#233, ADR-0028)', () => {
  test('the Library, Account health and Watch come from Xomoni here, and none of it reaches a server or storage', async ({
    page,
  }) => {
    const email = uniqueEmail('places-read');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    const sent: string[] = [];
    page.on('request', (request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    await page.goto(`/#ext=${EXT}`);
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();

    await page.goto('/dashboard/library');
    await expect(page.getByRole('tab', { name: 'Posts 2' })).toBeVisible();
    const posts = page.getByRole('list', { name: 'Posts' });
    await expect(posts.getByRole('listitem')).toHaveCount(2);
    await expect(posts).toContainText(SECRET_POST);
    await expect(posts.getByRole('link', { name: /Open on X/ }).first()).toHaveAttribute(
      'href',
      'https://x.com/i/status/1800000000000000001',
    );
    await page.getByRole('textbox', { name: 'Search the Library' }).fill('older');
    await expect
      .poll(() => fake.received.filter((m) => m.type === 'xomoni-read' && m.query === 'older').length)
      .toBe(1);

    await page.goto('/dashboard/health');
    await expect(page.getByRole('list', { name: 'Your X accounts' })).toContainText('X answered slowly');

    await page.goto('/dashboard/watch');
    await expect(page.getByRole('region', { name: `Watch: ${SECRET_SEARCH}` })).toContainText('Found by the search');

    // Every read named this browser's device, and nothing Xomoni answered went anywhere else.
    const reads = fake.received.filter((m) => m.type === 'xomoni-read');
    expect(reads.length).toBeGreaterThanOrEqual(4);
    expect(new Set(reads.map((m) => m.deviceId))).toEqual(new Set([fake.state.connection?.deviceId]));
    for (const words of [SECRET_POST, SECRET_SEARCH, 'X answered slowly']) {
      expect(sent.filter((line) => line.includes(words) || line.includes(encodeURIComponent(words)))).toEqual([]);
    }
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage]
        .flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`))
        .join('\n'),
    );
    expect(stored).not.toContain(SECRET_POST);
    expect(stored).not.toContain(SECRET_SEARCH);
  });
});

test.describe('Xomoni’s settings on xomoni.com, changed in this browser (#234, ADR-0029)', () => {
  test('shows Xomoni’s settings, and hands each change to Xomoni, which answers what it stored', async ({ page }) => {
    const email = uniqueEmail('settings');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    await page.goto(`/#ext=${EXT}`);
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();

    await page.goto('/dashboard/settings');
    const pace = page.getByRole('region', { name: /^Pace/ });
    await expect(pace.getByText('Custom', { exact: true })).toBeVisible();
    await pace.getByRole('button', { name: 'Back to Careful' }).click();
    await expect(pace.getByText('Careful', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Saved in Xomoni/)).toBeVisible();

    await page.getByRole('combobox', { name: 'From' }).selectOption('9');
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('9');
    await page.getByRole('textbox', { name: 'Search 2' }).fill('#rust');
    await page.getByRole('button', { name: 'Save searches' }).click();
    await expect(page.getByRole('button', { name: 'Save searches' })).toBeDisabled();
    // The daily numbers choice is the account's, in the cloud: it shows here too.
    await expect(page.getByRole('switch', { name: 'Show my numbers on xomoni.com' })).toBeVisible();

    const changes = fake.received.filter((m) => m.type === 'xomoni-settings');
    expect(changes.map((m) => m.change)).toEqual([
      { preset: 'careful' },
      { activeHours: { enabled: true, start: 9, end: 23 } },
      { watch: ['xomoni', '#rust'] },
    ]);
    expect(new Set(changes.map((m) => m.deviceId))).toEqual(new Set([fake.state.connection?.deviceId]));
  });

  test('without Xomoni in this browser, says where the settings live', async ({ page }) => {
    const email = uniqueEmail('settings-none');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('region', { name: 'Xomoni’s settings: in Xomoni' })).toBeVisible();
    await page.getByRole('button', { name: 'Open in Xomoni' }).click();
    await expect(page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' })).toBeVisible();
  });
});

test.describe('A cleanup planned on xomoni.com, started in Xomoni (#235)', () => {
  test('counts what the plan matches in Xomoni, and hands the plan over without starting anything', async ({
    page,
  }) => {
    const email = uniqueEmail('plan');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    await page.goto(`/#ext=${EXT}`);
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();

    await page.goto('/dashboard/cleanup');
    await page.getByRole('radio', { name: 'Replies' }).check();
    await expect(page).toHaveURL(/\/dashboard\/cleanup\?what=reply$/);
    await expect(page.getByText('1,234')).toBeVisible();
    await page.getByRole('button', { name: 'Review and start in Xomoni' }).click();
    await expect(page.getByText(/Xomoni opened its Cleanup page with your plan/)).toBeVisible();

    const plans = fake.received.filter((m) => m.type === 'xomoni-plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ deviceId: fake.state.connection?.deviceId, plan: { target: 'reply' } });
    // Only a plan and reads went to Xomoni: no job action, nothing that starts work.
    expect(fake.received.filter((m) => m.type === 'xomoni-job')).toEqual([]);
  });
});

test.describe('Your replies on xomoni.com, picked for a cleanup in Xomoni (#256)', () => {
  test('lists your replies from Xomoni here, finds them by whom they answer, and hands only the picked ones over', async ({
    page,
  }) => {
    const email = uniqueEmail('replies');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    const sent: string[] = [];
    page.on('request', (request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    await page.goto(`/#ext=${EXT}`);
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();

    await page.goto('/dashboard/comments');
    const replies = page.getByRole('list', { name: 'Your replies' });
    await expect(replies.getByRole('listitem')).toHaveCount(2);
    await expect(replies).toContainText(SECRET_REPLY);
    await page.getByRole('button', { name: '@bob · 1' }).click();
    await expect(replies.getByRole('listitem')).toHaveCount(1);
    await expect(replies).toContainText('To @bob');

    await page.getByRole('checkbox', { name: /^Pick your reply of/ }).check();
    await expect(page.getByRole('status').filter({ hasText: 'picked' })).toHaveText('1 reply picked');
    await page.getByRole('button', { name: 'Review and remove in Xomoni' }).click();
    await expect(page.getByText(/Xomoni opened its Cleanup page with your plan/)).toBeVisible();

    const plans = fake.received.filter((m) => m.type === 'xomoni-plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      deviceId: fake.state.connection?.deviceId,
      plan: { target: 'reply', skipSelfReplies: false, onlyIds: ['1800000000000000011'] },
    });
    // Nothing that starts work went to Xomoni, and the replies went nowhere else.
    expect(fake.received.filter((m) => m.type === 'xomoni-job')).toEqual([]);
    expect(
      sent.filter((line) => line.includes(SECRET_REPLY) || line.includes(encodeURIComponent(SECRET_REPLY))),
    ).toEqual([]);
  });
});

test.describe('Replies to you on xomoni.com, kept by Xomoni (#256, ADR-0030)', () => {
  test('shows what Xomoni kept, links each reply to X, offers no way to hide or block, and sends it nowhere', async ({
    page,
  }) => {
    const email = uniqueEmail('incoming');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    const sent: string[] = [];
    page.on('request', (request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    await page.goto(`/#ext=${EXT}`);
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();

    await page.goto('/dashboard/comments');
    await page.getByRole('tab', { name: 'Replies to you' }).click();
    const replies = page.getByRole('list', { name: 'Replies to you' });
    await expect(replies).toContainText(SECRET_INCOMING);
    await expect(replies.getByRole('link', { name: /Open on X/ })).toHaveAttribute(
      'href',
      'https://x.com/i/status/1800000000000000031',
    );
    await expect(page.getByRole('heading', { name: 'Replies to you each day' })).toBeVisible();
    await expect(page.getByRole('button', { name: '@carol · 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: /hide|block|report|mute/i })).toHaveCount(0);

    const reads = fake.received.filter((m) => m.type === 'xomoni-read' && m.what === 'incoming');
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(sent.filter((line) => line.includes('5d1a') || line.includes(encodeURIComponent(SECRET_INCOMING)))).toEqual(
      [],
    );
  });
});

test.describe('Xomoni’s actions on a phone (#251)', () => {
  test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

  test('say that Xomoni runs on a computer, and offer to send the page there', async ({ page }) => {
    const email = uniqueEmail('actions-phone');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);

    await page.goto('/dashboard/watch');
    await page.getByRole('button', { name: 'Open in Xomoni' }).click();

    const dialog = page.getByRole('dialog', { name: 'Xomoni runs on a computer' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send to my computer' })).toBeVisible();
  });

  test('a cleanup plan made on a phone goes to the computer in the link (#235)', async ({ page }) => {
    const email = uniqueEmail('plan-phone');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);

    await page.goto('/dashboard/cleanup');
    await page.getByRole('radio', { name: 'Likes' }).check();
    await expect(page).toHaveURL(/\?what=like$/);
    await page.getByRole('button', { name: 'Review and start in Xomoni' }).click();
    await expect(page.getByRole('dialog', { name: 'Xomoni runs on a computer' })).toBeVisible();
  });
});
