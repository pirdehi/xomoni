import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { AGENTS } from './support/browsers';
import { PASSWORD, followEmailLink, passwordInput, signIn, signOut, submit, uniqueEmail } from './support/flows';
import { hydrated } from './support/hydration';
import { expect, test } from './support/test';

// /welcome, the checklist that ticks itself (docs/scenarios/244-welcome.md, #244, ADR-0025, #345): what Xomoni opens on
// install, with its id in the fragment, and what the page sees by itself: Xomoni answering in this browser, someone
// signed in here, and Xomoni signed in with them. Signing up or in from it comes back to it. Xomoni is played at the
// page, as Chrome exposes an extension that lists xomoni.com in `externally_connectable`: it answers a hello as a test
// says, signs in with the site's code (`pair_device` on the local stack) and signs out, recording every message.
// Xomoni's own side, the tab it opens on install, is in e2e/extension/welcome.spec.ts.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

/** The three steps, as the checklist names them. */
const INSTALLED = 'Install Xomoni in this browser';
const ACCOUNT = 'Sign in to xomoni.com, or create a free account';
const CONNECTED = 'Xomoni signs in with you, in this browser';

/** What the checklist says while Xomoni signs in by itself, or hasn't. */
const CONNECT_HINT =
  'Xomoni signs in with you by itself in this browser. If it hasn’t, open Xomoni and press Sign in to xomoni.com once.';

/**
 * How the played Xomoni answers: as installed (`yes`), not there (Chrome's `lastError`, as for one removed or turned
 * off), not at all (`silent`, as for one that hangs), or out of shape (`garbled`).
 */
type Answering = 'yes' | 'not-there' | 'silent' | 'garbled';

/** The played Xomoni: how it answers, how it stands, and every message the pages sent, with the id they sent it to. */
interface PlayedXomoni {
  answering: Answering;
  connection: { deviceId: string; token: string; account: string; connectedAt: number } | null;
  signedOutAt: number | null;
  leftAt: number;
  received: { id: string; type: string; code?: unknown; replace?: unknown }[];
}

/** What the page's `chrome.runtime` does with a message: answer it, say nobody is there, or say nothing. */
type Delivery = { kind: 'answer'; answer: unknown } | { kind: 'not-there' } | { kind: 'silent' };

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** Xomoni's answer to a message, as `cloud/website.ts` gives it: a hello, a sign-in with the site's code, a sign-out. */
async function answer(xomoni: PlayedXomoni, message: Record<string, unknown>): Promise<unknown> {
  switch (message.type) {
    case 'xomoni-hello': {
      const { connection } = xomoni;
      return {
        ok: true,
        state: {
          version: '0.5.3',
          connection: connection && {
            deviceId: connection.deviceId,
            account: connection.account,
            connectedAt: connection.connectedAt,
          },
          signedOutAt: xomoni.signedOutAt,
          leftAt: xomoni.leftAt,
        },
      };
    }
    case 'xomoni-sign-in': {
      if (xomoni.connection && xomoni.connection.deviceId !== message.replace)
        return { ok: false, reason: 'already_connected' };
      if (xomoni.connection) await asExtension('unpair_device', { token: xomoni.connection.token });
      const paired = await asExtension('pair_device', {
        code: message.code,
        name: 'Chrome on macOS',
        version: '0.5.3',
      });
      if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
      const [{ device_id, token, account }] = paired.json as [{ device_id: string; token: string; account: string }];
      xomoni.connection = { deviceId: device_id, token, account, connectedAt: Date.now() };
      xomoni.signedOutAt = null;
      return { ok: true, account, deviceId: device_id };
    }
    case 'xomoni-sign-out': {
      if (!xomoni.connection) return { ok: true, signedOut: false };
      await asExtension('unpair_device', { token: xomoni.connection.token });
      xomoni.connection = null;
      xomoni.signedOutAt = Date.now();
      xomoni.leftAt = xomoni.signedOutAt;
      return { ok: true, signedOut: true };
    }
    default:
      return { ok: false, reason: 'invalid' };
  }
}

/**
 * Plays Xomoni, installed in this browser as a fresh install (no account, never signed out), in every tab of
 * `context`. Chrome hands a message to the extension the page names; any other id gets Chrome's "nobody is there".
 */
async function playXomoni(context: BrowserContext): Promise<PlayedXomoni> {
  const xomoni: PlayedXomoni = { answering: 'yes', connection: null, signedOutAt: null, leftAt: 0, received: [] };
  await context.exposeFunction(
    'xomoniFakeExtension',
    async (id: string, message: Record<string, unknown>): Promise<Delivery> => {
      xomoni.received.push({ id, type: String(message.type), code: message.code, replace: message.replace });
      if (id !== EXT || xomoni.answering === 'not-there') return { kind: 'not-there' };
      if (xomoni.answering === 'silent') return { kind: 'silent' };
      if (xomoni.answering === 'garbled' && message.type === 'xomoni-hello')
        return { kind: 'answer', answer: { ok: true, state: { version: 3, connection: 'yes' } } };
      return { kind: 'answer', answer: await answer(xomoni, message) };
    },
  );
  await context.addInitScript(() => {
    const deliver = (window as unknown as { xomoniFakeExtension: (id: string, m: unknown) => Promise<Delivery> })
      .xomoniFakeExtension;
    const runtime: {
      lastError?: { message: string };
      sendMessage: (id: string, message: unknown, callback: (answer: unknown) => void) => void;
    } = {
      sendMessage(id, message, callback) {
        void deliver(id, message).then((delivery) => {
          if (delivery.kind === 'silent') return;
          if (delivery.kind === 'answer') {
            callback(delivery.answer);
            return;
          }
          runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          callback(undefined);
          runtime.lastError = undefined;
        });
      },
    };
    Object.defineProperty(window, 'chrome', { value: { runtime }, configurable: true });
  });
  return xomoni;
}

/** The messages the pages sent Xomoni, without the hellos. */
const actions = (xomoni: PlayedXomoni) => xomoni.received.map((m) => m.type).filter((t) => t !== 'xomoni-hello');

/** The checklist on the page. */
const checklist = (page: Page): Locator => page.getByRole('region', { name: 'Getting started' });

/** The checklist's three steps, as they read. */
const steps = (page: Page): Locator => checklist(page).getByRole('listitem');

/** /welcome, as Xomoni opens it once installed: with its id in the fragment. */
async function openedByXomoni(page: Page): Promise<void> {
  await page.goto(`/welcome#ext=${EXT}`);
  // The site keeps the id and clears it from the address bar once its scripts ran.
  await expect(page).toHaveURL(/\/welcome$/);
}

/** The id of Xomoni this browser keeps, from a page Xomoni opened (`#ext=`). */
const rememberedId = (page: Page) => page.evaluate(() => window.localStorage.getItem('xomoni.extension'));

/** Fills the sign-in form the page is on and submits it. */
async function signInHere(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await passwordInput(page).fill(password);
  await submit(page, 'Sign in');
}

/** Presses Tab until `target` has the keyboard focus, as someone with only a keyboard would. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 40; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('the keyboard never reached it');
}

/** Makes the page come back into view, as when the person returns to its tab: the site looks for Xomoni again. */
const backInView = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test.describe('the welcome checklist (#244)', { tag: '@task-244' }, () => {
  test('S244-01 the page Xomoni opens ticks Xomoni installed, and offers an account that comes back here', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    await openedByXomoni(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);
    await expect(checklist(page).getByRole('link', { name: 'Create a free account' })).toHaveAttribute(
      'href',
      '/signup?next=%2Fwelcome',
    );
    await expect(checklist(page).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fwelcome',
    );
    await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toContainText(
      'Click the puzzle icon next to the address bar, then the pin next to Xomoni. In Edge, click Show in toolbar instead.',
    );
    await expect(page.getByRole('button', { name: 'Continue without an account' })).toBeVisible();
    expect(await rememberedId(page)).toBe(EXT);
    // The page only asked how Xomoni stands.
    expect(actions(xomoni)).toEqual([]);
  });

  test('S244-02 signing up from /welcome comes back to it through the email, and Xomoni signs in with the new account', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    const email = uniqueEmail('welcome-signup');
    await openedByXomoni(page);

    await checklist(page).getByRole('link', { name: 'Create a free account' }).click();
    await expect(page).toHaveURL(/\/signup\?next=%2Fwelcome$/);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await passwordInput(page).fill(PASSWORD);
    await submit(page, 'Create account');
    await expect(page.getByText('Check your inbox')).toBeVisible();

    const link = await followEmailLink(page, email, 'Confirm your Xomoni account');
    expect(new URL(link, 'http://site').searchParams.get('next')).toBe('/welcome');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
    expect(actions(xomoni)).toEqual(['xomoni-sign-in']);
    expect(xomoni.connection?.account).toBe('e•••@xomoni.test');

    await checklist(page).getByRole('link', { name: 'Open your dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('S244-03 signing in from /welcome comes back to it, and the steps tick as Xomoni signs in', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    const email = uniqueEmail('welcome-signin');
    await createConfirmedUser(email, PASSWORD);
    await openedByXomoni(page);

    await checklist(page).getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fwelcome$/);
    await signInHere(page, email);

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
    // The steps are announced as they tick.
    await expect(checklist(page).getByRole('list')).toHaveAttribute('aria-live', 'polite');
    await expect(checklist(page).getByRole('link', { name: /^(Create a free account|Sign in)$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue without an account' })).toBeVisible();
    expect(actions(xomoni)).toEqual(['xomoni-sign-in']);

    await checklist(page).getByRole('link', { name: 'Open your dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('S244-04 an address that names no extension id is ignored: nothing kept, nothing asked there', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    for (const bad of ['ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP', 'abcdefghijklmnop', 'qrstuvwxyzqrstuvwxyzqrstuvwxyzqr']) {
      await page.goto(`/welcome#ext=${bad}`);
      await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
      await expect(steps(page)).toHaveText([INSTALLED, ACCOUNT, CONNECTED]);
      await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toHaveCount(0);
      expect(await rememberedId(page)).toBeNull();
      expect(xomoni.received.filter((m) => m.id === bad)).toEqual([]);
    }
    expect(xomoni.received.filter((m) => m.id === EXT)).toEqual([]);
  });

  test('S244-05 an answer from Xomoni out of shape counts as no answer', async ({ page, context }) => {
    const xomoni = await playXomoni(context);
    xomoni.answering = 'garbled';
    await openedByXomoni(page);

    await expect(steps(page)).toHaveText([INSTALLED, ACCOUNT, CONNECTED]);
    await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toHaveCount(0);
    expect(xomoni.received.some((m) => m.id === EXT && m.type === 'xomoni-hello')).toBe(true);
    expect(actions(xomoni)).toEqual([]);
  });

  test('S244-06 a wrong password from /welcome’s Sign in stays on the sign-in page, still bound for /welcome', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    const email = uniqueEmail('welcome-wrong');
    await createConfirmedUser(email, PASSWORD);
    await openedByXomoni(page);
    await checklist(page).getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fwelcome$/);

    await signInHere(page, email, 'not the password 1');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'That email and password don’t match an account.',
    );
    await expect(page).toHaveURL(/\/login\?next=%2Fwelcome$/);
    expect(actions(xomoni)).toEqual([]);

    await passwordInput(page).fill(PASSWORD);
    await submit(page, 'Sign in');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
  });

  test('S244-07 a Xomoni removed or turned off since shows as not installed, and ticks again once it is back', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    xomoni.answering = 'not-there';
    await openedByXomoni(page);

    await expect(steps(page)).toHaveText([INSTALLED, ACCOUNT, CONNECTED]);
    await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toHaveCount(0);
    // The id stays, to ask again.
    expect(await rememberedId(page)).toBe(EXT);

    xomoni.answering = 'yes';
    await backInView(page);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toBeVisible();
  });

  test('S244-08 a Xomoni that doesn’t answer shows its steps as checking, then as to do', async ({ page, context }) => {
    const xomoni = await playXomoni(context);
    xomoni.answering = 'silent';
    await page.goto(`/welcome#ext=${EXT}`);

    await expect(steps(page)).toHaveText([`${INSTALLED}: checking…`, ACCOUNT, `${CONNECTED}: checking…`]);
    await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveCount(0);
    // The page waits 5 seconds for an answer.
    await expect(steps(page)).toHaveText([INSTALLED, ACCOUNT, CONNECTED], { timeout: 10_000 });
    await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toHaveCount(0);
  });

  test('S244-09 when xomoni.com can’t make the one-time code, the last step says what to do, and ticks once it can', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    const email = uniqueEmail('welcome-code');
    await createConfirmedUser(email, PASSWORD);
    const failing = '**/rest/v1/rpc/create_pairing_code';
    await page.route(failing, (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' }),
    );
    await openedByXomoni(page);
    await checklist(page).getByRole('link', { name: 'Sign in' }).click();
    await signInHere(page, email);

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, CONNECTED]);
    await expect(checklist(page)).toContainText(CONNECT_HINT);
    await expect(checklist(page).getByRole('link', { name: 'Open your dashboard' })).toHaveCount(0);
    expect(actions(xomoni)).toEqual([]);

    await page.unroute(failing);
    await backInView(page);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
    expect(actions(xomoni)).toEqual(['xomoni-sign-in']);
  });

  test('S244-10 the id Xomoni names stays in the browser: no request to the site or its database carries it', async ({
    page,
    context,
  }) => {
    const sent: string[] = [];
    context.on('request', (request) => {
      sent.push([request.url(), request.headers()['referer'] ?? '', request.postData() ?? ''].join(' '));
    });
    await playXomoni(context);
    const email = uniqueEmail('welcome-id');
    await createConfirmedUser(email, PASSWORD);
    await openedByXomoni(page);
    await checklist(page).getByRole('link', { name: 'Sign in' }).click();
    await signInHere(page, email);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((line) => line.includes(EXT))).toEqual([]);
    expect(await page.evaluate(() => window.location.href)).not.toContain(EXT);
  });

  test('S244-11 signed out, /welcome only asks how Xomoni stands: it signs Xomoni neither in nor out', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    // Xomoni signed in to an account a minute ago, before anyone signed in on this site.
    xomoni.connection = {
      deviceId: '9e000000-0000-4000-8000-000000000244',
      token: 'not-a-real-token',
      account: 'o•••@example.com',
      connectedAt: Date.now() - 60_000,
    };
    await openedByXomoni(page);

    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, `${CONNECTED}: done`]);
    await expect(checklist(page).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fwelcome',
    );
    await backInView(page);
    await page.reload();
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, `${CONNECTED}: done`]);
    expect(xomoni.received.length).toBeGreaterThan(1);
    expect(actions(xomoni)).toEqual([]);
    expect(xomoni.connection.account).toBe('o•••@example.com');
  });

  test('S244-12 Xomoni gets one one-time code, through Chrome alone: in no address and no storage, and none again', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    const email = uniqueEmail('welcome-once');
    await createConfirmedUser(email, PASSWORD);
    const addresses: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) addresses.push(frame.url());
    });
    await openedByXomoni(page);
    await checklist(page).getByRole('link', { name: 'Sign in' }).click();
    await signInHere(page, email);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);

    const signIns = xomoni.received.filter((m) => m.type === 'xomoni-sign-in');
    expect(signIns).toHaveLength(1);
    const code = String(signIns[0]?.code);
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    // A fresh Xomoni had no connection to replace.
    expect(signIns[0]?.replace).toBeUndefined();
    const stored = await page.evaluate(() =>
      [window.localStorage, window.sessionStorage]
        .flatMap((storage) => Object.keys(storage).map((key) => `${key}=${storage.getItem(key) ?? ''}`))
        .join('\n'),
    );
    expect(stored).not.toContain(code);
    expect(addresses.filter((address) => address.includes(code))).toEqual([]);

    // Xomoni is now one of the account's browsers: the page hands it nothing more.
    await page.reload();
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
    await backInView(page);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
    expect(actions(xomoni)).toEqual(['xomoni-sign-in']);
  });

  test('S244-13 with no Xomoni and no account, installing is the next step, and nothing is kept', async ({ page }) => {
    // No `chrome.runtime` on the page: no extension lists xomoni.com in this browser.
    await page.goto('/welcome');

    await expect(steps(page)).toHaveText([INSTALLED, ACCOUNT, CONNECTED]);
    await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
    await expect(checklist(page).getByRole('link', { name: 'Create a free account' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toHaveCount(0);
    await expect(checklist(page).getByRole('link', { name: 'Open your dashboard' })).toHaveCount(0);
    expect(await rememberedId(page)).toBeNull();

    await checklist(page).getByRole('link', { name: 'Install Xomoni' }).click();
    await expect(page).toHaveURL(/\/install$/);
  });

  test('S244-14 signed in, with no Xomoni in this browser yet, only installing is left to do first', async ({
    page,
  }) => {
    const email = uniqueEmail('welcome-noext');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);

    await page.goto('/welcome');
    await expect(steps(page)).toHaveText([INSTALLED, `${ACCOUNT}: done`, CONNECTED]);
    await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
    await expect(checklist(page).getByRole('link', { name: /^(Create a free account|Sign in)$/ })).toHaveCount(0);
    await expect(checklist(page).getByRole('link', { name: 'Open your dashboard' })).toHaveCount(0);
  });

  test('S244-15 going from creating an account to signing in, or back, still comes back to /welcome', async ({
    page,
    context,
  }) => {
    await playXomoni(context);
    const email = uniqueEmail('welcome-switch');
    await createConfirmedUser(email, PASSWORD);
    await openedByXomoni(page);
    await checklist(page).getByRole('link', { name: 'Create a free account' }).click();
    await expect(page).toHaveURL(/\/signup\?next=%2Fwelcome$/);

    // The person has an account after all.
    await page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fwelcome$/);
    await expect(page.getByRole('main').getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup?next=%2Fwelcome',
    );
    await signInHere(page, email);

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
  });

  test('S244-16 Continue without an account closes the tab Xomoni opened, and asks nothing more of Xomoni', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    await page.goto('/');
    // A tab with nothing before it in its history, as the one Xomoni opens.
    const [welcome] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate((id) => void window.open(`/welcome#ext=${id}`, '_blank', 'noopener'), EXT),
    ]);
    await expect(welcome).toHaveURL(/\/welcome$/);
    await expect(steps(welcome)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);
    const closed = welcome.waitForEvent('close');

    await (await hydrated(welcome.getByRole('button', { name: 'Continue without an account' }))).click();
    await closed;
    expect(actions(xomoni)).toEqual([]);
    expect(xomoni.connection).toBeNull();
  });

  test('S244-17 in a tab the person came to from another page, Continue without an account says the tab can be closed', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    await page.goto('/');
    await page.goto(`/welcome#ext=${EXT}`);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);

    await (await hydrated(page.getByRole('button', { name: 'Continue without an account' }))).click();
    await expect(page.getByRole('status')).toHaveText('You can close this tab: Xomoni is ready on your computer.');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);
    expect(actions(xomoni)).toEqual([]);
  });

  test('S244-18 the keyboard alone reaches each step’s button and Continue without an account', async ({
    page,
    context,
  }) => {
    await playXomoni(context);
    await openedByXomoni(page);
    const create = await hydrated(checklist(page).getByRole('link', { name: 'Create a free account' }));

    await tabTo(page, create);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/signup\?next=%2Fwelcome$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/welcome$/);

    await tabTo(page, await hydrated(checklist(page).getByRole('link', { name: 'Sign in' })));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login\?next=%2Fwelcome$/);
    await page.goBack();

    const go = await hydrated(page.getByRole('button', { name: 'Continue without an account' }));
    await tabTo(page, go);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText('You can close this tab: Xomoni is ready on your computer.');
    // The checklist is a named region whose steps are announced politely as they tick.
    await expect(checklist(page)).toBeVisible();
    await expect(checklist(page).getByRole('list')).toHaveAttribute('aria-live', 'polite');
  });

  test('S244-19 no serious accessibility violation, in light and dark, from the first step to the last', async ({
    page,
    context,
  }) => {
    await playXomoni(context);
    const email = uniqueEmail('welcome-axe');
    await createConfirmedUser(email, PASSWORD);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      // From another page, so that /welcome loads anew rather than only changing its fragment.
      await page.goto('/');
      await openedByXomoni(page);
      await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await (await hydrated(page.getByRole('button', { name: 'Continue without an account' }))).click();
      await expect(page.getByRole('status')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    }

    await page.goto('/login?next=%2Fwelcome');
    await signInHere(page, email);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectNoSeriousA11yViolations(page);
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, userAgent: AGENTS.phone });

    test('S244-20 on a phone, the checklist fits the screen and its next step is installing', async ({ page }) => {
      await page.goto('/welcome');

      await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
      await expect(steps(page)).toHaveText([INSTALLED, ACCOUNT, CONNECTED]);
      await expect(checklist(page).getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
      await expect(page.getByRole('button', { name: 'Continue without an account' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });

  test('S244-21 a reload, and a second tab with no id in its address, still find Xomoni from the kept id', async ({
    page,
    context,
  }) => {
    await playXomoni(context);
    await openedByXomoni(page);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);

    await page.reload();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toBeVisible();

    const second = await context.newPage();
    await second.goto('/welcome');
    await expect(steps(second)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);
    await expect(second.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toBeVisible();
  });

  test('S244-22 signing out unticks the account and Xomoni; signing in from /welcome ticks them again', async ({
    page,
    context,
  }) => {
    const xomoni = await playXomoni(context);
    const email = uniqueEmail('welcome-again');
    await createConfirmedUser(email, PASSWORD);
    await openedByXomoni(page);
    await checklist(page).getByRole('link', { name: 'Sign in' }).click();
    await signInHere(page, email);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);

    await signOut(page);
    expect(xomoni.connection).toBeNull();
    await page.goto('/welcome');
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, ACCOUNT, CONNECTED]);

    await checklist(page).getByRole('link', { name: 'Sign in' }).click();
    await signInHere(page, email);
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(steps(page)).toHaveText([`${INSTALLED}: done`, `${ACCOUNT}: done`, `${CONNECTED}: done`]);
    expect(actions(xomoni)).toEqual(['xomoni-sign-in', 'xomoni-sign-out', 'xomoni-sign-in']);
  });
});
