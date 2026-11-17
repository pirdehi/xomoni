import type { Page } from '@playwright/test';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** The fake extension's state, as its service worker keeps it (`cloud/web-session.ts`). */
interface FakeState {
  connection: { deviceId: string; token: string; account: string; connectedAt: number } | null;
  signedOutAt: number | null;
  leftAt: number;
}

/**
 * Plays the extension in this browser as Chrome does for one that lists xomoni.com in `externally_connectable`: a
 * hello, a sign-in that trades the code with `pair_device` (ending a connection it is told to replace) and a
 * sign-out that ends the token. Returns its state and every message it received, in order.
 */
async function installFakeExtension(page: Page) {
  const state: FakeState = { connection: null, signedOutAt: null, leftAt: 0 };
  const received: { type: string; code?: string; replace?: string }[] = [];
  await page.exposeFunction('xomoniFakeExtension', async (id: string, message: Record<string, unknown>) => {
    if (id !== EXT) return undefined;
    received.push(message as { type: string });
    switch (message.type) {
      case 'xomoni-hello': {
        const { connection } = state;
        return {
          ok: true,
          state: {
            version: '0.3.0',
            connection: connection && {
              deviceId: connection.deviceId,
              account: connection.account,
              connectedAt: connection.connectedAt,
            },
            signedOutAt: state.signedOutAt,
            leftAt: state.leftAt,
          },
        };
      }
      case 'xomoni-sign-in': {
        if (state.connection && state.connection.deviceId !== message.replace)
          return { ok: false, reason: 'already_connected' };
        if (state.connection) await asExtension('unpair_device', { token: state.connection.token });
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.3.0',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, token, account }] = paired.json as [{ device_id: string; token: string; account: string }];
        state.connection = { deviceId: device_id, token, account, connectedAt: Date.now() };
        state.signedOutAt = null;
        await asExtension('device_report', { token, version: '0.3.0', jobs: [] });
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-sign-out': {
        if (!state.connection) return { ok: true, signedOut: false };
        await asExtension('unpair_device', { token: state.connection.token });
        state.connection = null;
        state.signedOutAt = Date.now();
        state.leftAt = state.signedOutAt;
        return { ok: true, signedOut: true };
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

/** The types of the messages received, without the hellos. */
const actions = (received: { type: string }[]) => received.map((m) => m.type).filter((t) => t !== 'xomoni-hello');

test.describe('one sign-in for xomoni.com and the extension (#232, ADR-0025)', () => {
  test('signing in on xomoni.com signs Xomoni in; signing out there signs it out too', async ({ page }) => {
    const email = uniqueEmail('one-sign-in');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeExtension(page);

    // A page the extension opened: the site keeps its id and clears it from the address bar.
    await page.goto(`/#ext=${EXT}`);
    await expect(page).toHaveURL(/\/$/);

    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);

    const browsers = page.getByRole('region', { name: 'Connected browsers' });
    await expect(browsers).toContainText('Chrome on macOS');
    await expect(browsers).toContainText('This browser');
    expect(actions(fake.received)).toEqual(['xomoni-sign-in']);
    expect(fake.received.find((m) => m.type === 'xomoni-sign-in')?.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(fake.state.connection?.account).toBe('e•••@xomoni.test');

    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    expect(actions(fake.received)).toEqual(['xomoni-sign-in', 'xomoni-sign-out']);
    expect(fake.state.connection).toBeNull();
    expect(fake.state.signedOutAt).not.toBeNull();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('signing out in Xomoni signs xomoni.com out once its page is back in view', async ({ page }) => {
    const email = uniqueEmail('one-sign-out');
    await createConfirmedUser(email, PASSWORD);
    const fake = await installFakeExtension(page);
    await page.goto(`/#ext=${EXT}`);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText('This browser');

    // The person signs out in the extension.
    if (fake.state.connection) await asExtension('unpair_device', { token: fake.state.connection.token });
    fake.state.connection = null;
    fake.state.signedOutAt = Date.now();
    fake.state.leftAt = fake.state.signedOutAt;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to Xomoni' })).toBeVisible();
    // Signing in again on the website signs Xomoni in again.
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText('This browser');
    expect(actions(fake.received)).toEqual(['xomoni-sign-in', 'xomoni-sign-in']);
  });
});
