import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Xomoni's settings on xomoni.com (docs/scenarios/234-website-settings.md, #234, ADR-0029, #345): read from Xomoni in
// this browser and changed there, within Xomoni's own rules: pacing only back to Careful, active hours, failures in a
// row before a pause, notifications, keeping going while away, and the active account's Watch searches. Xomoni is
// played at the page, as Chrome exposes an extension that lists xomoni.com in `externally_connectable`: it signs in
// with the site's code (`pair_device` on the local stack), keeps its settings, applies each change as a test says, and
// records every message.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

/** Xomoni's settings as it answers them (`XomoniSettings`). */
interface Settings {
  preset: 'careful' | 'custom';
  pace: Record<string, { perHour: number; perDay: number }>;
  activeHours: { enabled: boolean; start: number; end: number };
  notifications: boolean;
  whileAway: boolean;
  maxFailures: number;
  handle: string;
  watch: string[];
}

/** A custom pace, as someone who changed it in Xomoni has it. */
const CUSTOM: Settings = {
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

/** How the played Xomoni answers. */
interface Holds {
  settings: Settings;
  /** Refuses every read and change with this reason, or answers nothing (`silent`). */
  refuse: string | null;
  /** Answers changes with nothing at all, as a Xomoni that doesn't answer. */
  silent: boolean;
  /** Xomoni's own rules: how it stores a change it was asked for. */
  rules: (settings: Settings, change: Record<string, unknown>) => Settings;
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

/** Xomoni's usual rules, simplified: Careful sets the careful pace; anything else is taken as it came. */
function usualRules(settings: Settings, change: Record<string, unknown>): Settings {
  const next = { ...settings, ...change };
  if (change.preset === 'careful') {
    next.pace = Object.fromEntries(Object.keys(settings.pace).map((a) => [a, { perHour: 3, perDay: 30 }]));
  }
  return next;
}

/** Plays Xomoni in this browser: the one sign-in, reads of its settings, and changes; returns what it holds and got. */
async function installFakeXomoni(page: Page, given: Partial<Holds> = {}) {
  const holds: Holds = { settings: { ...CUSTOM }, refuse: null, silent: false, rules: usualRules, ...given };
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
            version: '0.5.3',
            connection: state.connection && { ...state.connection, connectedAt: 1 },
            signedOutAt: null,
            leftAt: 0,
          },
        };
      case 'xomoni-sign-in': {
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.5.3',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, account }] = paired.json as [{ device_id: string; account: string }];
        state.connection = { deviceId: device_id, account };
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-read':
        if (holds.refuse) return { ok: false, reason: holds.refuse };
        return message.what === 'settings' ? { ok: true, what: 'settings', settings: holds.settings } : undefined;
      case 'xomoni-settings':
        if (holds.silent) return undefined;
        if (holds.refuse) return { ok: false, reason: holds.refuse };
        if (message.deviceId !== state.connection?.deviceId) return { ok: false, reason: 'other_account' };
        holds.settings = holds.rules(holds.settings, message.change as Record<string, unknown>);
        return { ok: true, settings: holds.settings };
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

/** A new account, signed in, with the played Xomoni in this browser signed in with it; opens Settings. */
async function openSettings(page: Page, given: Partial<Holds> = {}) {
  const email = uniqueEmail('settings');
  await createConfirmedUser(email, PASSWORD);
  const fake = await installFakeXomoni(page, given);
  await page.goto(`/#ext=${EXT}`);
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();
  await page.goto('/dashboard/settings');
  return fake;
}

/** A new account, signed in, in a browser where no Xomoni answers; opens Settings. */
async function openSettingsAlone(page: Page) {
  const email = uniqueEmail('settings-alone');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await page.goto('/dashboard/settings');
}

/** The changes Xomoni received, oldest first. */
const changes = (received: readonly Record<string, unknown>[]) =>
  received.filter((m) => m.type === 'xomoni-settings').map((m) => m.change);
/** One of the place's cards, by its title. */
const card = (page: Page, title: string | RegExp) => page.getByRole('region', { name: title });
/** What the page says after a change. */
const SAVED = /^Saved in Xomoni\. A running job keeps its settings until it is paused and resumed\./;

test.describe('Xomoni’s settings on xomoni.com', { tag: '@task-234' }, () => {
  test('S234-01 shows Xomoni’s settings as Xomoni has them: pace, hours, safety and searches', async ({ page }) => {
    await openSettings(page);
    await expect(
      page.getByText('Read from Xomoni in this browser and changed there, within its safety rules.'),
    ).toBeVisible();
    const pace = card(page, /^Pace/);
    await expect(pace.getByText('Custom', { exact: true })).toBeVisible();
    await expect(pace.getByRole('table')).toContainText('Delete posts & replies');
    await expect(page.getByRole('switch', { name: 'Only work during active hours' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('8');
    await expect(page.getByRole('combobox', { name: 'Until' })).toHaveValue('23');
    await expect(page.getByRole('combobox', { name: /Pause a job after this many/ })).toHaveValue('2');
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Keep going while away' })).toBeChecked();
    await expect(card(page, 'Watch searches for @ada').getByRole('textbox', { name: 'Search 1' })).toHaveValue(
      'xomoni',
    );
  });

  test('S234-02 Back to Careful sets Xomoni’s careful pace, and the page says it is saved there', async ({ page }) => {
    const fake = await openSettings(page);
    const pace = card(page, /^Pace/);
    await pace.getByRole('button', { name: 'Back to Careful' }).click();
    await expect(pace.getByText('Careful', { exact: true })).toBeVisible();
    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(pace.getByRole('button', { name: 'Back to Careful' })).toHaveCount(0);
    expect(changes(fake.received)).toEqual([{ preset: 'careful' }]);
  });

  test('S234-03 active hours: their start and end, then off, each go to Xomoni', async ({ page }) => {
    const fake = await openSettings(page);
    await page.getByRole('combobox', { name: 'From' }).selectOption('9');
    await expect(page.getByText(SAVED)).toBeVisible();
    await page.getByRole('combobox', { name: 'Until' }).selectOption('22');
    await expect(page.getByRole('combobox', { name: 'Until' })).toHaveValue('22');
    await page.getByRole('switch', { name: 'Only work during active hours' }).click();
    await expect(page.getByRole('switch', { name: 'Only work during active hours' })).not.toBeChecked();
    expect(changes(fake.received)).toEqual([
      { activeHours: { enabled: true, start: 9, end: 23 } },
      { activeHours: { enabled: true, start: 9, end: 22 } },
      { activeHours: { enabled: false, start: 9, end: 22 } },
    ]);
  });

  test('S234-04 safety: failures before a pause, notifications and keeping going while away', async ({ page }) => {
    const fake = await openSettings(page);
    await page.getByRole('combobox', { name: /Pause a job after this many/ }).selectOption('1');
    await expect(page.getByRole('combobox', { name: /Pause a job after this many/ })).toHaveValue('1');
    await page.getByRole('switch', { name: 'Desktop notifications' }).click();
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).not.toBeChecked();
    await page.getByRole('switch', { name: 'Keep going while away' }).click();
    await expect(page.getByRole('switch', { name: 'Keep going while away' })).not.toBeChecked();
    expect(changes(fake.received)).toEqual([{ maxFailures: 1 }, { notifications: false }, { whileAway: false }]);
  });

  test('S234-05 Watch searches are edited here and saved together, trimmed', async ({ page }) => {
    const fake = await openSettings(page);
    const searches = card(page, 'Watch searches for @ada');
    const save = searches.getByRole('button', { name: 'Save searches' });
    await expect(save).toBeDisabled();
    await searches.getByRole('textbox', { name: 'Search 2' }).fill('  #rust ');
    await searches.getByRole('button', { name: 'Add a search' }).click();
    await searches.getByRole('textbox', { name: 'Search 3' }).fill('open source');
    await save.click();
    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(save).toBeDisabled();
    expect(changes(fake.received)).toEqual([{ watch: ['xomoni', '#rust', 'open source'] }]);
  });

  test('S234-06 a search can’t be longer than 100 characters', async ({ page }) => {
    await openSettings(page);
    const first = card(page, 'Watch searches for @ada').getByRole('textbox', { name: 'Search 1' });
    await first.fill('');
    await first.pressSequentially('x'.repeat(110));
    await expect(first).toHaveValue('x'.repeat(100));
  });

  test('S234-07 there are five searches at most: Add a search goes away at five', async ({ page }) => {
    await openSettings(page);
    const searches = card(page, 'Watch searches for @ada');
    for (let n = 0; n < 3; n++) await searches.getByRole('button', { name: 'Add a search' }).click();
    await expect(searches.getByRole('textbox')).toHaveCount(5);
    await expect(searches.getByRole('button', { name: 'Add a search' })).toHaveCount(0);
  });

  test('S234-08 a change Xomoni doesn’t take says so, and shows nothing changed', async ({ page }) => {
    const fake = await openSettings(page);
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
    fake.holds.refuse = 'refused';
    await page.getByRole('switch', { name: 'Desktop notifications' }).click();
    await expect(page.getByText('Xomoni didn’t take that change, so nothing changed.')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
  });

  test('S234-09 Xomoni signed in to another account changes nothing, and the page says why', async ({ page }) => {
    const fake = await openSettings(page);
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
    fake.holds.refuse = 'other_account';
    await page.getByRole('switch', { name: 'Desktop notifications' }).click();
    await expect(
      page.getByText('Xomoni in this browser isn’t signed in to this account, so nothing changed.'),
    ).toBeVisible();
  });

  test('S234-10 a Xomoni that doesn’t answer a change: the page says nothing changed, and to open it', async ({
    page,
  }) => {
    const fake = await openSettings(page);
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
    fake.holds.silent = true;
    await page.getByRole('switch', { name: 'Desktop notifications' }).click();
    await expect(
      page.getByText('Xomoni didn’t answer, so nothing changed. Open it on this computer and try again.'),
    ).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
  });

  test('S234-11 a Xomoni older than the page says to install the newest version', async ({ page }) => {
    await openSettings(page, { refuse: 'invalid' });
    await expect(
      page.getByText(/Your Xomoni is older than this page and can’t show its settings here yet\./),
    ).toBeVisible();
  });

  test('S234-12 the page can’t raise the pace: the table only shows it, and only Back to Careful goes to Xomoni', async ({
    page,
  }) => {
    const fake = await openSettings(page);
    const pace = card(page, /^Pace/);
    await expect(pace.getByRole('table')).toBeVisible();
    await expect(pace.getByRole('spinbutton')).toHaveCount(0);
    await expect(pace.getByRole('textbox')).toHaveCount(0);
    await expect(pace).toContainText('Custom pacing is set in Xomoni, where its table lives.');
    await pace.getByRole('button', { name: 'Back to Careful' }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    for (const change of changes(fake.received)) expect(Object.keys(change as object)).not.toContain('pace');
    expect(new Set(fake.received.map((m) => m.type))).toEqual(
      new Set(['xomoni-hello', 'xomoni-sign-in', 'xomoni-read', 'xomoni-settings']),
    );
  });

  test('S234-13 the searches never reach a server: they go only to Xomoni in this browser', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (request: Request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    const fake = await openSettings(page);
    const searches = card(page, 'Watch searches for @ada');
    await searches.getByRole('textbox', { name: 'Search 2' }).fill('secret-search-4b1a');
    await searches.getByRole('button', { name: 'Save searches' }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    expect(changes(fake.received)).toEqual([{ watch: ['xomoni', 'secret-search-4b1a'] }]);
    expect(sent.filter((line) => line.includes('secret-search-4b1a'))).toEqual([]);
  });

  test('S234-14 Xomoni’s own rules win: the page shows what Xomoni stored, not what it asked for', async ({ page }) => {
    // A Xomoni that keeps at least two failures before a pause, whatever it is asked.
    const fake = await openSettings(page, {
      rules: (settings, change) => ({
        ...usualRules(settings, change),
        maxFailures: Math.max(2, settings.maxFailures),
      }),
    });
    await page.getByRole('combobox', { name: /Pause a job after this many/ }).selectOption('1');
    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Pause a job after this many/ })).toHaveValue('2');
    expect(changes(fake.received)).toEqual([{ maxFailures: 1 }]);
  });

  test('S234-15 a Xomoni that knows no X account yet has no searches to show, and says where to start', async ({
    page,
  }) => {
    await openSettings(page, { settings: { ...CUSTOM, handle: '', watch: [] } });
    await expect(card(page, 'Watch searches')).toContainText(
      'Xomoni doesn’t know an X account yet: open X in Xomoni first.',
    );
    await expect(card(page, 'Watch searches').getByRole('textbox')).toHaveCount(0);
  });

  test('S234-16 without Xomoni in this browser, the page says where the settings live, and the numbers choice stays', async ({
    page,
  }) => {
    await openSettingsAlone(page);
    await expect(card(page, 'Xomoni’s settings: in Xomoni')).toContainText(
      'Xomoni’s settings live in Xomoni on your computer, and change only there.',
    );
    await expect(page.getByRole('switch', { name: 'Show my numbers on xomoni.com' })).toBeVisible();
    await page.getByRole('button', { name: 'Open in Xomoni' }).click();
    await expect(page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' })).toBeVisible();
  });

  test('S234-17 a search changed and changed back leaves nothing to save', async ({ page }) => {
    const fake = await openSettings(page);
    const searches = card(page, 'Watch searches for @ada');
    const first = searches.getByRole('textbox', { name: 'Search 1' });
    await first.fill('something else');
    await expect(searches.getByRole('button', { name: 'Save searches' })).toBeEnabled();
    await first.fill('xomoni');
    await expect(searches.getByRole('button', { name: 'Save searches' })).toBeDisabled();
    expect(changes(fake.received)).toEqual([]);
  });

  test('S234-18 a search added and removed before saving sends nothing', async ({ page }) => {
    const fake = await openSettings(page);
    const searches = card(page, 'Watch searches for @ada');
    await searches.getByRole('button', { name: 'Add a search' }).click();
    await searches.getByRole('textbox', { name: 'Search 3' }).fill('#maybe');
    await searches.getByRole('button', { name: 'Remove search 3' }).click();
    await expect(searches.getByRole('textbox')).toHaveCount(2);
    await expect(searches.getByRole('button', { name: 'Save searches' })).toBeDisabled();
    expect(changes(fake.received)).toEqual([]);
  });

  test('S234-19 keyboard only: Tab to Desktop notifications and Space turns them off in Xomoni', async ({ page }) => {
    const fake = await openSettings(page);
    const notifications = page.getByRole('switch', { name: 'Desktop notifications' });
    await expect(notifications).toBeChecked();
    for (let presses = 0; presses < 80; presses++) {
      if (await notifications.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(notifications).toBeFocused();
    await page.keyboard.press('Space');
    await expect(notifications).not.toBeChecked();
    expect(changes(fake.received)).toEqual([{ notifications: false }]);
  });

  test('S234-20 the settings have no serious accessibility violation, in light and dark', async ({ page }) => {
    await openSettings(page);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(card(page, /^Pace/)).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    }
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('S234-21 Settings says Xomoni runs on a computer, and offers to send the page there', async ({ page }) => {
      await openSettingsAlone(page);
      await page.getByRole('button', { name: 'Open in Xomoni' }).click();
      const dialog = page.getByRole('dialog', { name: 'Xomoni runs on a computer' });
      await expect(dialog.getByRole('button', { name: 'Send to my computer' })).toBeVisible();
    });
  });

  test('S234-22 a reload reads the settings again from Xomoni, as it stored them', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('switch', { name: 'Keep going while away' }).click();
    await expect(page.getByRole('switch', { name: 'Keep going while away' })).not.toBeChecked();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Keep going while away' })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
  });

  test('S234-23 two quick changes both reach Xomoni, and both stay', async ({ page }) => {
    const fake = await openSettings(page);
    await page.getByRole('switch', { name: 'Desktop notifications' }).click();
    await page.getByRole('switch', { name: 'Keep going while away' }).click();
    await expect.poll(() => changes(fake.received)).toEqual([{ notifications: false }, { whileAway: false }]);
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Keep going while away' })).not.toBeChecked();
    expect(fake.holds.settings).toMatchObject({ notifications: false, whileAway: false });
  });

  test('S234-24 Read again asks Xomoni for its settings once more', async ({ page }) => {
    const fake = await openSettings(page);
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
    fake.holds.settings = { ...fake.holds.settings, notifications: false };
    await page.getByRole('button', { name: 'Read again' }).click();
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).not.toBeChecked();
  });
});
