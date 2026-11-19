import type { Page } from '@playwright/test';
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
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('with Xomoni here, Pause goes to it by the job’s id there, and its answer shows', async ({ page }) => {
    const email = uniqueEmail('actions-here');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeXomoni(page);
    await page.goto(`/#ext=${EXT}`);
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
});
