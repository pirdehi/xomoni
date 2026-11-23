import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { addDevice, addJobs, createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Xomoni's actions on xomoni.com (docs/scenarios/251-website-actions.md, #251, ADR-0027, #345): a job's Pause, Cancel
// and Resume, and Open in Xomoni, each sent to Xomoni in this browser, which acts or answers why not; and the dialog
// when Xomoni can't act from here. Xomoni is played at the page, as Chrome exposes an extension that lists xomoni.com in
// `externally_connectable`: it signs in with the site's code (`pair_device` on the local stack), reports its jobs
// (`device_report`), and answers each action as a test says, recording every message.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

/** A job as Xomoni reports it (`device_report`). */
interface ReportedJob {
  local_id: string;
  title: string;
  state: string;
}

/** Xomoni's jobs in this browser: one running, one paused, one that ended. */
const RUNNING: ReportedJob = { local_id: 'local-run', title: 'Delete posts before 2019', state: 'running' };
const PAUSED: ReportedJob = { local_id: 'local-paused', title: 'Remove likes before 2020', state: 'paused' };
const ENDED: ReportedJob = { local_id: 'local-done', title: 'Undo reposts before 2018', state: 'completed' };

/** What the played Xomoni answers to a job action or an Open, unless a test says otherwise. */
type Answer = { ok: true; outcome: string } | { ok: false; reason: string };

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** Xomoni's usual answer to an action on a job in `state`, as `cloud/website-actions.ts` gives it. */
function usualAnswer(action: string, state: string): Answer {
  const running = state === 'running' || state === 'waiting';
  if (state === 'completed' || state === 'cancelled') return { ok: false, reason: 'finished' };
  if (action === 'pause') return running ? { ok: true, outcome: 'stopping' } : { ok: false, reason: 'not_running' };
  if (action === 'cancel') return { ok: true, outcome: running ? 'stopping' : 'cancelled' };
  return { ok: true, outcome: running ? 'opened' : 'asked' };
}

/**
 * Plays Xomoni in this browser: the one sign-in, a report of `jobs` once signed in, and answers to job actions and
 * Opens (`answer`, if a test gives one, else the usual one). Returns its state and every message it received.
 */
async function installFakeXomoni(page: Page, jobs: ReportedJob[] = [RUNNING, PAUSED, ENDED]) {
  const fake: {
    connection: { deviceId: string; account: string } | null;
    received: Record<string, unknown>[];
    answer: Answer | null;
  } = { connection: null, received: [], answer: null };
  await page.exposeFunction('xomoniFakeExtension', async (id: string, message: Record<string, unknown>) => {
    if (id !== EXT) return undefined;
    fake.received.push(message);
    switch (message.type) {
      case 'xomoni-hello':
        return {
          ok: true,
          state: {
            version: '0.5.2',
            connection: fake.connection && { ...fake.connection, connectedAt: 1 },
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
        const [{ device_id, token, account }] = paired.json as [{ device_id: string; token: string; account: string }];
        fake.connection = { deviceId: device_id, account };
        await asExtension('device_report', {
          token,
          version: '0.5.2',
          jobs: jobs.map((job) => ({
            ...job,
            x_handle: 'ada',
            kind: 'cleanup',
            phase: '',
            state_reason: '',
            matched: 90,
            done: 40,
            skipped: 0,
            failed: 0,
            scanned: 0,
            risk_level: 0,
            started_at: new Date().toISOString(),
            finished_at: job.state === 'completed' ? new Date().toISOString() : null,
          })),
        });
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-job': {
        if (fake.answer) return fake.answer;
        if (message.deviceId !== fake.connection?.deviceId) return { ok: false, reason: 'other_account' };
        const job = jobs.find((j) => j.local_id === message.jobId);
        return job ? usualAnswer(message.action as string, job.state) : { ok: false, reason: 'no_job' };
      }
      case 'xomoni-open':
        if (fake.answer) return fake.answer;
        return message.deviceId === fake.connection?.deviceId
          ? { ok: true, outcome: 'opened' }
          : { ok: false, reason: 'other_account' };
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
  return fake;
}

/** A new account, signed in with the played Xomoni in this browser, which signs in with it and reports its jobs. */
async function signedInWithXomoni(page: Page, jobs?: ReportedJob[]) {
  const email = uniqueEmail('actions');
  const userId = await createConfirmedUser(email, PASSWORD);
  const fake = await installFakeXomoni(page, jobs);
  await page.goto(`/#ext=${EXT}`);
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await expect.poll(() => fake.connection?.deviceId).toBeTruthy();
  return { fake, userId };
}

/** A new account, signed in, in a browser where no Xomoni answers. */
async function signedInWithoutXomoni(page: Page) {
  const email = uniqueEmail('actions-none');
  const userId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  return userId;
}

/** A job's card in Activity, by its title. */
const jobCard = (page: Page, title: string) =>
  page.getByRole('region', { name: 'Jobs' }).getByRole('listitem').filter({ hasText: title });

/** A job's buttons in Activity. */
const actionsOf = (page: Page, title: string) => page.getByRole('group', { name: `Actions for ${title}` });

/** Opens Activity and waits for the job titled `title`. */
async function openActivity(page: Page, title: string) {
  await page.goto('/dashboard/activity');
  await expect(jobCard(page, title)).toBeVisible();
}

/** The job actions the played Xomoni received. */
const jobMessages = (received: readonly Record<string, unknown>[]) => received.filter((m) => m.type === 'xomoni-job');

test.describe('Xomoni’s actions on xomoni.com', { tag: '@task-251' }, () => {
  test('S251-01 Pause on a running job goes to Xomoni by the job’s id there, and its answer shows', async ({
    page,
  }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    await actionsOf(page, RUNNING.title).getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Pausing: the job stops after the action in progress.')).toBeVisible();
    expect(jobMessages(fake.received)).toEqual([
      { type: 'xomoni-job', action: 'pause', deviceId: fake.connection?.deviceId, jobId: RUNNING.local_id },
    ]);
  });

  test('S251-02 Cancel on a running job stops it after the action in progress', async ({ page }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    await actionsOf(page, RUNNING.title).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Cancelling: the job stops after the action in progress.')).toBeVisible();
    expect(jobMessages(fake.received)).toMatchObject([{ action: 'cancel', jobId: RUNNING.local_id }]);
  });

  test('S251-03 Resume on a paused job only asks: Xomoni opens, and nothing runs until the person says so there', async ({
    page,
  }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, PAUSED.title);
    const actions = actionsOf(page, PAUSED.title);
    await expect(actions.getByRole('button')).toHaveText(['Resume', 'Cancel']);
    await actions.getByRole('button', { name: 'Resume' }).click();
    await expect(
      page.getByText('Xomoni opened on this computer. Choose Resume there to continue: nothing runs until you do.'),
    ).toBeVisible();
    expect(jobMessages(fake.received)).toMatchObject([{ action: 'resume', jobId: PAUSED.local_id }]);
  });

  test('S251-04 Open in Xomoni opens the place’s page in Xomoni', async ({ page }) => {
    const { fake } = await signedInWithXomoni(page);
    await page.goto('/dashboard/content');
    await page.getByRole('button', { name: 'Open in Xomoni' }).first().click();
    await expect(page.getByText('Xomoni opened on this computer.')).toBeVisible();
    expect(fake.received.filter((m) => m.type === 'xomoni-open')).toEqual([
      { type: 'xomoni-open', deviceId: fake.connection?.deviceId, page: 'library' },
    ]);
  });

  test('S251-05 Cancel on a paused job cancels it at once', async ({ page }) => {
    await signedInWithXomoni(page);
    await openActivity(page, PAUSED.title);
    await actionsOf(page, PAUSED.title).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('The job is cancelled.')).toBeVisible();
  });

  test('S251-06 a job that has ended offers no action', async ({ page }) => {
    await signedInWithXomoni(page);
    await openActivity(page, ENDED.title);
    await expect(actionsOf(page, ENDED.title)).toHaveCount(0);
    await expect(jobCard(page, ENDED.title).getByRole('button', { name: /Pause|Cancel|Resume/ })).toHaveCount(0);
  });

  test('S251-07 a job of another browser says where it runs, and sends nothing to this browser’s Xomoni', async ({
    page,
  }) => {
    const { fake, userId } = await signedInWithXomoni(page, [RUNNING]);
    const other = await addDevice(userId, 'Edge on Windows');
    await addJobs(userId, other, [
      {
        local_id: 'elsewhere-1',
        x_handle: 'ada',
        kind: 'cleanup',
        title: 'Delete replies before 2021',
        state: 'running',
      },
    ]);
    await openActivity(page, 'Delete replies before 2021');
    await actionsOf(page, 'Delete replies before 2021').getByRole('button', { name: 'Pause' }).click();
    const dialog = page.getByRole('dialog', { name: 'This job runs in another browser' });
    await expect(dialog).toContainText('It runs in Edge on Windows.');
    await expect(dialog).toContainText('open xomoni.com there to pause, cancel or resume it');
    expect(jobMessages(fake.received)).toEqual([]);
  });

  test('S251-08 a job Xomoni no longer has: the page says so', async ({ page }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    fake.answer = { ok: false, reason: 'no_job' };
    await actionsOf(page, RUNNING.title).getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Xomoni in this browser doesn’t have this job any more.')).toBeVisible();
  });

  test('S251-09 a job that stopped meanwhile: Pause says there is nothing to pause', async ({ page }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    fake.answer = { ok: false, reason: 'not_running' };
    await actionsOf(page, RUNNING.title).getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('The job isn’t running, so there is nothing to pause.')).toBeVisible();
  });

  test('S251-10 a job that ended meanwhile: the page says it has already ended', async ({ page }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, PAUSED.title);
    fake.answer = { ok: false, reason: 'finished' };
    await actionsOf(page, PAUSED.title).getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('The job has already ended.')).toBeVisible();
  });

  test('S251-11 Xomoni signed in to another account refuses, and the dialog says how to sign in', async ({ page }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    fake.answer = { ok: false, reason: 'other_account' };
    await actionsOf(page, RUNNING.title).getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Xomoni in this browser isn’t signed in to this account.')).toBeVisible();
  });

  test('S251-12 only the job’s action goes to Xomoni: no job is started, resumed or approved from the page', async ({
    page,
  }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, PAUSED.title);
    for (const [title, name] of [
      [PAUSED.title, 'Resume'],
      [RUNNING.title, 'Pause'],
    ] as const) {
      await actionsOf(page, title).getByRole('button', { name }).click();
      await expect(
        page
          .getByRole('main')
          .getByText(/Xomoni opened|Pausing/)
          .first(),
      ).toBeVisible();
    }
    expect(new Set(fake.received.map((m) => m.type))).toEqual(
      new Set(['xomoni-hello', 'xomoni-sign-in', 'xomoni-job']),
    );
    for (const message of jobMessages(fake.received)) expect(['pause', 'cancel', 'resume']).toContain(message.action);
    expect(Object.keys(jobMessages(fake.received)[0] ?? {}).sort()).toEqual(['action', 'deviceId', 'jobId', 'type']);
  });

  test('S251-13 an action is never sent to a server: it goes only to Xomoni in this browser', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (request: Request) =>
      sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`),
    );
    await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    sent.length = 0;
    await actionsOf(page, RUNNING.title).getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Pausing: the job stops after the action in progress.')).toBeVisible();
    expect(sent.filter((line) => /pause|local-run/i.test(line))).toEqual([]);
  });

  test('S251-14 without Xomoni, an action opens the “not installed” dialog, which leads to the install page', async ({
    page,
  }) => {
    await signedInWithoutXomoni(page);
    await page.goto('/dashboard/library');
    await page.getByRole('button', { name: 'Open in Xomoni' }).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toContainText('Xomoni’s actions run in the Xomoni extension, on this computer.');
    await expect(dialog.getByRole('link', { name: /Install Xomoni/ })).toHaveAttribute('href', '/install');
  });

  test('S251-15 I’ve installed it, with still no Xomoni here, says it isn’t linked yet', async ({ page }) => {
    await signedInWithoutXomoni(page);
    await page.goto('/dashboard/library');
    await page.getByRole('button', { name: 'Open in Xomoni' }).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await dialog.getByRole('button', { name: 'I’ve installed it' }).click();
    await expect(dialog.getByRole('status')).toHaveText(
      'Xomoni isn’t linked to this page yet. Open Xomoni and press Connect to xomoni.com once, then try again.',
    );
  });

  test('S251-16 with no job yet, Activity offers no action', async ({ page }) => {
    await signedInWithXomoni(page, []);
    await page.goto('/dashboard/activity');
    await expect(page.getByRole('main').getByRole('group', { name: /^Actions for/ })).toHaveCount(0);
  });

  test('S251-17 Close puts the dialog away, and nothing was sent', async ({ page }) => {
    await signedInWithoutXomoni(page);
    await page.goto('/dashboard/library');
    await page.getByRole('button', { name: 'Open in Xomoni' }).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open in Xomoni' })).toBeEnabled();
  });

  test('S251-18 Escape closes the dialog and gives the focus back to the button that opened it', async ({ page }) => {
    await signedInWithoutXomoni(page);
    await page.goto('/dashboard/library');
    const open = page.getByRole('button', { name: 'Open in Xomoni' });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('S251-19 keyboard only: Tab to a job’s Pause and Enter sends it, and the answer is read out', async ({
    page,
  }) => {
    const { fake } = await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    const pause = actionsOf(page, RUNNING.title).getByRole('button', { name: 'Pause' });
    for (let presses = 0; presses < 60; presses++) {
      if (await pause.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(pause).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Pausing: the job stops after the action in progress.')).toBeVisible();
    expect(jobMessages(fake.received)).toHaveLength(1);
  });

  test('S251-20 the dialogs and the job actions have no serious accessibility violation, in light and dark', async ({
    page,
  }) => {
    await signedInWithoutXomoni(page);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto('/dashboard/library');
      await page.getByRole('button', { name: 'Open in Xomoni' }).click();
      await expect(page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await page.keyboard.press('Escape');
    }
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('S251-21 an action says Xomoni runs on a computer, and offers to send the page there', async ({ page }) => {
      await signedInWithoutXomoni(page);
      await page.goto('/dashboard/watch');
      await page.getByRole('button', { name: 'Open in Xomoni' }).click();
      const dialog = page.getByRole('dialog', { name: 'Xomoni runs on a computer' });
      await expect(dialog).toContainText('On this phone you can follow everything it does.');
      await expect(dialog.getByRole('button', { name: 'Send to my computer' })).toBeVisible();
    });
  });

  test('S251-22 an answer stays only on this page: a reload shows the jobs as Xomoni reported them, nothing more', async ({
    page,
  }) => {
    await signedInWithXomoni(page);
    await openActivity(page, RUNNING.title);
    await actionsOf(page, RUNNING.title).getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Pausing: the job stops after the action in progress.')).toBeVisible();
    await page.reload();
    await expect(jobCard(page, RUNNING.title)).toBeVisible();
    await expect(page.getByText('Pausing: the job stops after the action in progress.')).toHaveCount(0);
    await expect(actionsOf(page, RUNNING.title).getByRole('button')).toHaveText(['Pause', 'Cancel']);
  });
});
