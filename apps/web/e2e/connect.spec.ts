import type { Page } from '@playwright/test';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const NONCE = 'AbCdEfGhIjKlMnOpQrStUv';
const OPENED_BY_XOMONI = `/connect#ext=${EXT}&nonce=${NONCE}`;

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
 * Plays the extension in this page, as Chrome does for an extension that lists xomoni.com in `externally_connectable`:
 * `chrome.runtime.sendMessage` reaches a function that checks the message like the service worker and trades the code
 * with `pair_device`. Returns what it received.
 */
async function installFakeExtension(page: Page) {
  const received: unknown[] = [];
  await page.exposeFunction('xomoniFakeExtension', async (id: string, message: Record<string, unknown>) => {
    received.push({ id, ...message });
    if (id !== EXT || message.type !== 'xomoni-pair' || message.nonce !== NONCE)
      return { ok: false, reason: 'not_asked' };
    const paired = await asExtension('pair_device', { code: message.code, name: 'Chrome on macOS', version: '0.3.0' });
    if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
    const [{ account }] = paired.json as [{ account: string }];
    return { ok: true, account };
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
  return received;
}

test.describe('connecting a browser from the extension’s Sign in (#228, ADR-0024, #232)', () => {
  test('signed out, the request waits through sign-in; Xomoni then signs in by itself and the dashboard shows the browser', async ({
    page,
  }) => {
    const email = uniqueEmail('connect');
    await createConfirmedUser(email, PASSWORD);
    const received = await installFakeExtension(page);

    await page.goto(OPENED_BY_XOMONI);
    await expect(page.getByRole('heading', { name: 'Connect this browser' })).toBeVisible();
    // The request leaves the address bar at once.
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=/connect');

    await signIn(page, email, PASSWORD, '/login?next=/connect');
    await expect(page).toHaveURL(/\/connect$/);
    // Signed in, Xomoni signs in at once: often too fast to see the account named while it does.
    await expect(page.getByText('Xomoni in this browser is signed in as e•••@xomoni.test.')).toBeVisible();
    // Other pages only asked how it stands (#232); the code went once, with the nonce.
    expect(received.filter((m) => (m as { type: string }).type !== 'xomoni-hello')).toEqual([
      { id: EXT, type: 'xomoni-pair', code: expect.stringMatching(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/), nonce: NONCE },
    ]);

    await page.getByRole('link', { name: 'Open the dashboard' }).click();
    await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Browsers' }).click();
    await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText('Chrome on macOS');
  });

  test('without Xomoni in the browser, it says what to check and sends nothing', async ({ page }) => {
    const email = uniqueEmail('connect-none');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);

    await page.goto(OPENED_BY_XOMONI);

    // Next.js's route announcer is an alert too, so the message is found by its text.
    await expect(page.getByRole('alert').filter({ hasText: 'Xomoni didn’t answer in this browser.' })).toBeVisible();
  });

  test('opened without a request, it says to start from Xomoni', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/Open Xomoni in Chrome and press/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the dashboard' })).toBeVisible();
  });
});
