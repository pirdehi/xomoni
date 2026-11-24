import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// *Your vault* on xomoni.com (docs/scenarios/426-website-vault.md, ADR-0028 as amended, #426): what the vault in
// Xomoni holds, read in this browser as counts and dates only, beside the Library. Xomoni is played at the page, as
// Chrome exposes an extension that lists xomoni.com in `externally_connectable`: it signs in with the site's code
// (`pair_device` on the local stack), then answers `what: 'vault'` from the summary a test gives it, and records every
// message.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DAY = 86_400_000;

/** A count only Xomoni knows: it must never reach a server or the site's storage. */
const SECRET_ROWS = 987_654;

/** The vault's summary, as Xomoni answers it (`VaultSummary`). */
const SUMMARY = {
  handle: 'ada',
  sources: [
    { source: 'x-archive', lastAt: Date.now() - 40 * DAY, freshness: 'due', rows: SECRET_ROWS },
    { source: 'x-analytics-posts', lastAt: Date.now() - DAY, freshness: 'fresh', rows: 12 },
    { source: 'x-analytics-days', lastAt: null, freshness: 'never', rows: 0 },
  ],
  archiveGeneratedAt: Date.UTC(2026, 9, 15, 12),
  imports: 3,
  captureGroupsOn: 0,
};

/** How the played Xomoni answers a read of the vault: a summary, a refusal, or silence. */
interface Holds {
  vault: unknown;
  refuse: string | null;
}

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** Plays Xomoni in this browser: the one sign-in, reads of the vault from `holds`, and opening a page. */
async function installFakeXomoni(page: Page, given: Partial<Holds> = {}) {
  const holds: Holds = { vault: SUMMARY, refuse: null, ...given };
  const state: { connection: { deviceId: string; account: string } | null } = { connection: null };
  const received: Record<string, unknown>[] = [];
  await page.exposeFunction('xomoniFakeExtension', async (id: string, message: Record<string, unknown>) => {
    if (id !== EXT) return undefined;
    received.push(message);
    switch (message.type) {
      case 'xomoni-hello':
        return {
          ok: true,
          state: {
            version: '0.7.0',
            connection: state.connection && { ...state.connection, connectedAt: 1 },
            signedOutAt: null,
            leftAt: 0,
          },
        };
      case 'xomoni-sign-in': {
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.7.0',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, account }] = paired.json as [{ device_id: string; account: string }];
        state.connection = { deviceId: device_id, account };
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-read':
        if (holds.refuse === 'silent') return undefined;
        if (holds.refuse) return { ok: false, reason: holds.refuse };
        if (message.deviceId !== state.connection?.deviceId) return { ok: false, reason: 'other_account' };
        if (message.what === 'vault') return { ok: true, what: 'vault', vault: holds.vault };
        if (message.what === 'library')
          return {
            ok: true,
            what: 'library',
            page: {
              handle: 'ada',
              counts: Object.fromEntries(
                ['post', 'reply', 'repost', 'like'].map((k) => [k, { present: 0, removed: 0 }]),
              ),
              matching: 0,
              items: [],
              next: null,
            },
          };
        return { ok: false, reason: 'invalid' };
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
  return { holds, state, received };
}

/** A new account, signed in, with the played Xomoni signed in with it; opens the Library, where the card is. */
async function openVault(page: Page, given: Partial<Holds> = {}) {
  const email = uniqueEmail('vault');
  await createConfirmedUser(email, PASSWORD);
  const fake = await installFakeXomoni(page, given);
  await page.goto(`/#ext=${EXT}`);
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();
  await page.goto('/dashboard/library');
  return fake;
}

/** A new account, signed in, in a browser where no Xomoni answers; opens the Library. */
async function openAlone(page: Page) {
  const email = uniqueEmail('vault-alone');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await page.goto('/dashboard/library');
}

const card = (page: Page) => page.getByRole('region', { name: 'Your vault', exact: true });
const files = (page: Page) => card(page).getByRole('list', { name: 'Your vault’s files' });
const vaultReads = (received: readonly Record<string, unknown>[]) =>
  received.filter((m) => m.type === 'xomoni-read' && m.what === 'vault');

test.describe('Your vault on xomoni.com', { tag: '@task-426' }, () => {
  test('S426-31 the card lists X’s files in the vault, each with its freshness, and the day X made the archive', async ({
    page,
  }) => {
    await openVault(page);
    const items = files(page).getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('X’s archive · 987,654 rows · 40 days old');
    await expect(items.nth(0)).toContainText('Due for a new copy');
    await expect(items.nth(1)).toContainText('X’s analytics of posts · 12 posts · 1 day old');
    await expect(items.nth(1)).toContainText('Up to date');
    await expect(items.nth(2)).toContainText('Not imported yet');
    await expect(card(page)).toContainText('X made your newest archive on Oct 15, 2026. 3 imports in all.');
    await expect(card(page)).toContainText('counts and dates only, and nothing here reaches our servers');
  });

  test('S426-32 Open in Xomoni opens the Vault page in Xomoni, and starts nothing', async ({ page }) => {
    const fake = await openVault(page);
    await card(page).getByRole('button', { name: 'Open in Xomoni' }).click();
    await expect
      .poll(() => fake.received.filter((m) => m.type === 'xomoni-open').map((m) => m.page))
      .toEqual(['vault']);
    expect(fake.received.some((m) => typeof m.type === 'string' && /import|plan|job/.test(m.type))).toBe(false);
  });

  test('S426-33 an empty vault says how to fill it', async ({ page }) => {
    await openVault(page, {
      vault: {
        ...SUMMARY,
        imports: 0,
        archiveGeneratedAt: null,
        sources: SUMMARY.sources.map((s) => ({ ...s, rows: 0, lastAt: null, freshness: 'never' })),
      },
    });
    await expect(card(page)).toContainText(
      'Your vault is empty. Download your archive or analytics from X yourself, then drop them on Xomoni’s Vault page.',
    );
  });

  test('S426-34 an answer with a file name in it is refused whole', async ({ page }) => {
    await openVault(page, { vault: { ...SUMMARY, fileName: 'twitter-2026.zip' } });
    await expect(card(page)).toContainText('Xomoni didn’t answer. Open it on this computer and try again.');
    await expect(files(page)).toHaveCount(0);
    await expect(page.getByText('twitter-2026.zip')).toHaveCount(0);
  });

  test('S426-35 a count written as text is refused', async ({ page }) => {
    await openVault(page, { vault: { ...SUMMARY, imports: '3' } });
    await expect(card(page)).toContainText('Xomoni didn’t answer.');
    await expect(files(page)).toHaveCount(0);
  });

  test('S426-36 a freshness the site doesn’t know is refused', async ({ page }) => {
    await openVault(page, { vault: { ...SUMMARY, sources: [{ ...SUMMARY.sources[0], freshness: 'stale' }] } });
    await expect(card(page)).toContainText('Xomoni didn’t answer.');
  });

  test('S426-37 a Xomoni that doesn’t answer: the card says so', async ({ page }) => {
    await openVault(page, { refuse: 'silent' });
    await expect(card(page)).toContainText('Xomoni didn’t answer. Open it on this computer and try again.');
  });

  test('S426-38 a Xomoni older than the page says to install the newest version', async ({ page }) => {
    await openVault(page, { refuse: 'invalid' });
    await expect(card(page)).toContainText('Your Xomoni is older than this page and can’t show your vault here yet.');
    await expect(card(page).getByRole('link', { name: 'Install the newest version' })).toBeVisible();
  });

  test('S426-39 a Xomoni signed in to another account shows nothing of its vault', async ({ page }) => {
    await openVault(page, { refuse: 'other_account' });
    await expect(card(page)).toContainText('Xomoni didn’t answer.');
    await expect(page.getByText('987,654')).toHaveCount(0);
  });

  test('S426-40 the vault’s counts reach no server and no storage, and each read names this browser', async ({
    page,
  }) => {
    const sent: string[] = [];
    page.on('request', (request: Request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    const fake = await openVault(page);
    await expect(files(page)).toContainText('987,654 rows');
    expect(sent.filter((line) => line.includes(String(SECRET_ROWS)))).toEqual([]);
    expect(new Set(vaultReads(fake.received).map((m) => m.deviceId))).toEqual(
      new Set([fake.state.connection?.deviceId]),
    );
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage].flatMap((store) =>
        Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`),
      ),
    );
    expect(stored.filter((entry) => entry.includes(String(SECRET_ROWS)))).toEqual([]);
  });

  test('S426-41 signed out, the page sends the person to sign in, and Xomoni is never asked', async ({ page }) => {
    const fake = await installFakeXomoni(page);
    await page.goto(`/dashboard/library#ext=${EXT}`);
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Flibrary/);
    expect(vaultReads(fake.received)).toEqual([]);
  });

  test('S426-42 the card holds only counts and dates: no text, no file name, no id of X’s', async ({ page }) => {
    const fake = await openVault(page);
    await expect(files(page)).toBeVisible();
    const [read] = vaultReads(fake.received);
    expect(Object.keys(read ?? {}).sort()).toEqual(['deviceId', 'type', 'what']);
    await expect(card(page).getByRole('link')).toHaveCount(0);
  });

  test('S426-43 without Xomoni here, the card says where the vault lives, and Open in Xomoni says how to get it', async ({
    page,
  }) => {
    await openAlone(page);
    const notHere = page.getByRole('region', { name: 'Your vault: in Xomoni' });
    await expect(notHere).toContainText('is kept by Xomoni on your computer: it never reaches our servers.');
    await notHere.getByRole('button', { name: 'Open in Xomoni' }).click();
    await expect(page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' })).toBeVisible();
  });

  test('S426-44 a vault with only the analytics: the archive is not imported yet', async ({ page }) => {
    await openVault(page, {
      vault: {
        ...SUMMARY,
        archiveGeneratedAt: null,
        sources: [{ ...SUMMARY.sources[0], lastAt: null, freshness: 'never', rows: 0 }, SUMMARY.sources[1]],
      },
    });
    await expect(files(page).getByRole('listitem').first()).toContainText('X’s archive · Not imported yet');
    await expect(card(page)).not.toContainText('X made your newest archive');
  });

  test('S426-45 the dialog without Xomoni closes with its button, and nothing opens', async ({ page }) => {
    await openAlone(page);
    await page
      .getByRole('region', { name: 'Your vault: in Xomoni' })
      .getByRole('button', { name: 'Open in Xomoni' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: /Close|Not now|Cancel/ })
      .first()
      .click();
    await expect(dialog).toBeHidden();
  });

  test('S426-46 the dialog closes with Escape too', async ({ page }) => {
    await openAlone(page);
    await page
      .getByRole('region', { name: 'Your vault: in Xomoni' })
      .getByRole('button', { name: 'Open in Xomoni' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('S426-47 Open in Xomoni works with the keyboard alone', async ({ page }) => {
    const fake = await openVault(page);
    const open = card(page).getByRole('button', { name: 'Open in Xomoni' });
    await expect(open).toBeVisible();
    await open.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => fake.received.filter((m) => m.type === 'xomoni-open').length).toBe(1);
  });

  test('S426-48 the card has no serious accessibility violation', async ({ page }) => {
    await openVault(page);
    await expect(files(page)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test.describe('on a phone, in dark mode', () => {
    test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

    test('S426-49 the card fits a phone’s width and reads well in dark colors', async ({ page }) => {
      await openVault(page);
      await expect(files(page)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await expectNoSeriousA11yViolations(page);
    });
  });

  test('S426-50 after a reload, the card reads the vault again and shows it the same', async ({ page }) => {
    const fake = await openVault(page);
    await expect(files(page).getByRole('listitem')).toHaveCount(3);
    const before = vaultReads(fake.received).length;
    await page.reload();
    await expect(files(page).getByRole('listitem')).toHaveCount(3);
    expect(vaultReads(fake.received).length).toBeGreaterThan(before);
  });
});
