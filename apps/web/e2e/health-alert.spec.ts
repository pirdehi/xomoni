import type { Page, Response } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import {
  addDevice,
  addJobs,
  asDatabase,
  createConfirmedUser,
  healthAlertOf,
  healthAlertQueueOf,
  updateJob,
} from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { apiSignIn } from './support/two-factor';
import { expect, test } from './support/test';

// The email when X warns an account (docs/scenarios/407-health-alert.md, #407, ADR-0042): the choice in Settings, off
// until the person turns it on; the alert the database queues when a job report's risk level rises to Retreat or
// above; the email it would send, made of the handle and fixed words; and the stop link, which works without signing
// in. Against the local stack, where the Resend key isn't in Vault, as until it is set up in production: the database
// sends nothing, and the tests read what it queued and the email it would send with the admin key, as its scheduler
// would (`asDatabase`).

/** The Settings card. */
const card = (page: Page) => page.getByRole('region', { name: 'When X warns your account' });
/** The card's switch. */
const choice = (page: Page) => card(page).getByRole('switch', { name: 'Email me when X warns my account' });

/** A new account, signed in; returns its id and email. */
async function signedIn(page: Page, label: string) {
  const email = uniqueEmail(label);
  const userId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  return { userId, email };
}

/** Opens Settings and waits until the choice is read and the switch can be used. */
async function openSettings(page: Page) {
  await page.goto('/dashboard/settings');
  await expect(choice(page)).toBeEnabled();
}

/** Turns the alert on in Settings and waits until it is stored. */
async function turnOn(page: Page, userId: string) {
  await openSettings(page);
  await choice(page).click();
  await expect(choice(page)).toBeChecked();
  await expect.poll(async () => (await healthAlertOf(userId))?.enabled).toBe(true);
}

/** A browser of the user's with one job of @ada_x at Normal; returns the device, to report later levels as Xomoni. */
async function withJob(userId: string, title = 'Delete posts before 2020') {
  const device = await addDevice(userId, 'Chrome on macOS');
  await addJobs(userId, device, [
    { local_id: 'job-1', x_handle: 'ada_x', kind: 'cleanup', title, state: 'running', risk_level: 0 },
  ]);
  return device;
}

/** Xomoni's next report of the job, at `level`. */
const report = (device: string, level: number) => updateJob(device, 'job-1', { risk_level: level });

/** The alerts waiting to be sent. */
const waiting = async (userId: string) =>
  (await healthAlertQueueOf(userId)).filter((alert) => !alert.sent_at && !alert.dropped_at);

/** The email the database would send the user now, or null. */
const emailOf = (userId: string) =>
  asDatabase<{ subject: string; text: string; html: string } | null>('health_alert_content', { owner: userId });

test.describe('the email when X warns an account', { tag: '@task-407' }, () => {
  test('S407-01 Settings offers the alert, off, and turning it on keeps the choice while sending isn’t set up', async ({
    page,
  }) => {
    const { userId } = await signedIn(page, 'alert-on');
    await openSettings(page);
    await expect(card(page)).toContainText('X’s warnings stop Xomoni on its own');
    await expect(choice(page)).not.toBeChecked();
    expect(await healthAlertOf(userId)).toBeNull();
    await choice(page).click();
    await expect(choice(page)).toBeChecked();
    await expect.poll(async () => (await healthAlertOf(userId))?.enabled).toBe(true);
    // No Resend key on this stack: the card says so, and the choice is kept for when it is.
    await expect(card(page)).toContainText(
      'Sending isn’t set up on xomoni.com yet, so nothing is sent until it is. Your choice is kept.',
    );
  });

  test('S407-02 a job report that rises to Retreat queues one alert, of the account and the level', async ({
    page,
  }) => {
    const { userId } = await signedIn(page, 'alert-rise');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    expect(await waiting(userId)).toEqual([{ x_handle: 'ada_x', level: 2, sent_at: null, dropped_at: null }]);
  });

  test('S407-03 the email names the account, says when Xomoni may resume, and links only to the dashboard', async ({
    page,
  }) => {
    const { userId } = await signedIn(page, 'alert-mail');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    const email = await emailOf(userId);
    expect(email?.subject).toBe('X warned @ada_x');
    expect(email?.text).toMatch(
      /^X warned @ada_x\. Xomoni stopped and won’t resume before [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d UTC, then goes at half its pace for a week\./,
    );
    expect(email?.text).toContain('Rest the account');
    const links = [...(email?.html.matchAll(/href="([^"]+)"/g) ?? [])].map((match) => match[1]);
    expect(links[0]).toBe('https://xomoni.com/dashboard/health');
    expect(links[1]).toMatch(/^https:\/\/xomoni\.com\/health-alert\/stop\?token=[0-9a-f-]{36}$/);
    expect(links).toHaveLength(2);
  });

  test('S407-04 turning it off keeps it off, and drops an alert still waiting', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-off');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    expect(await waiting(userId)).toHaveLength(1);
    await choice(page).click();
    await expect(choice(page)).not.toBeChecked();
    await expect.poll(async () => (await healthAlertOf(userId))?.enabled).toBe(false);
    expect(await waiting(userId)).toEqual([]);
    expect(await emailOf(userId)).toBeNull();
  });

  test('S407-05 the link in the email asks first, then stops the alerts, without signing in', async ({
    page,
    browser,
  }) => {
    const { userId } = await signedIn(page, 'alert-stop');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    const token = (await healthAlertOf(userId))?.stop_token ?? '';
    const stranger = await browser.newPage();
    await stranger.goto(`/health-alert/stop?token=${token}`);
    await expect(stranger.getByText('Stop the emails when X warns your account?')).toBeVisible();
    expect((await healthAlertOf(userId))?.enabled).toBe(true);
    await stranger.getByRole('button', { name: 'Stop the alerts' }).click();
    await expect(stranger.getByRole('status')).toContainText(
      'The alerts are stopped. No more will come, and none still waiting is sent.',
    );
    expect((await healthAlertOf(userId))?.enabled).toBe(false);
    expect(await waiting(userId)).toEqual([]);
    await stranger.close();
  });

  test('S407-06 a mail app’s own Unsubscribe stops the alerts in one click, from anywhere', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-one-click');
    await turnOn(page, userId);
    const token = (await healthAlertOf(userId))?.stop_token ?? '';
    const oneClick = await page.request.post(`/api/health-alert/stop?token=${token}`, {
      form: { 'List-Unsubscribe': 'One-Click' },
      headers: { origin: 'https://mail.example' },
    });
    expect(oneClick.status()).toBe(200);
    expect(await oneClick.text()).toBe('The alert is stopped.');
    expect((await healthAlertOf(userId))?.enabled).toBe(false);
  });

  test('S407-07 Caution, one rate limit, queues nothing: only Retreat and above do', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-caution');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 1);
    expect(await healthAlertQueueOf(userId)).toEqual([]);
  });

  test('S407-08 a stop link that isn’t complete stops nothing, and offers no button', async ({ page, browser }) => {
    const { userId } = await signedIn(page, 'alert-bad-link');
    await turnOn(page, userId);
    const stranger = await browser.newPage();
    await stranger.goto('/health-alert/stop?token=not-a-token');
    await expect(stranger.getByText(/^This link isn’t complete\./)).toBeVisible();
    await expect(stranger.getByRole('main').getByRole('button')).toHaveCount(0);
    const oneClick = await stranger.request.post('/api/health-alert/stop?token=not-a-token', {
      form: { 'List-Unsubscribe': 'One-Click' },
    });
    expect(oneClick.status()).toBe(400);
    expect((await healthAlertOf(userId))?.enabled).toBe(true);
    await stranger.close();
  });

  test('S407-09 the same level in later reports queues nothing more; a higher one, another', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-same');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    await report(device, 2);
    expect(await waiting(userId)).toHaveLength(1);
    await report(device, 3);
    expect((await waiting(userId)).map((alert) => alert.level)).toEqual([2, 3]);
    await report(device, 2);
    await report(device, 3);
    expect(await waiting(userId)).toHaveLength(2);
  });

  test('S407-10 without the Resend key, a send sends nothing, and the alert keeps waiting', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-no-key');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    expect(await asDatabase<number>('send_health_alerts')).toBe(0);
    expect(await waiting(userId)).toHaveLength(1);
    expect((await healthAlertOf(userId))?.last_sent_at).toBeNull();
  });

  test('S407-11 when the choice can’t be read, the card says so, rather than off, and holds the switch', async ({
    page,
  }) => {
    await signedIn(page, 'alert-read-error');
    await page.route('**/rest/v1/rpc/health_alert_status', (route) => route.abort());
    await page.goto('/dashboard/settings');
    await expect(card(page).getByRole('alert')).toHaveText('Couldn’t read your choice. Reload the page to try again.');
    await expect(choice(page)).toBeDisabled();
  });

  test('S407-12 when turning it on fails, the card says so, and the switch stays off', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-set-error');
    await openSettings(page);
    await page.route('**/rest/v1/rpc/set_health_alert', (route) => route.abort());
    await choice(page).click();
    await expect(card(page).getByRole('alert')).toHaveText('Couldn’t turn the alert on. Try again in a moment.');
    await expect(choice(page)).not.toBeChecked();
    expect(await healthAlertOf(userId)).toBeNull();
  });

  test('S407-13 another person reads neither someone’s choice nor any stop token or alert', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-owner');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    const other = uniqueEmail('alert-other');
    await createConfirmedUser(other, PASSWORD);
    // Signed in as the other person, through the Data API, as the website's own client would.
    const client = await apiSignIn(other, PASSWORD);
    const choices = await client.from('health_alerts').select('user_id, enabled');
    expect(choices.error).toBeNull();
    expect(choices.data).toEqual([]);
    expect((await client.from('health_alerts').select('stop_token')).error?.code).toBe('42501');
    expect((await client.from('health_alert_queue').select('x_handle')).error?.code).toBe('42501');
    expect((await client.from('health_alert_levels').select('x_handle')).error?.code).toBe('42501');
    expect((await client.rpc('health_alert_status')).data).toEqual([{ enabled: false, can_send: false }]);
    expect((await client.rpc('send_health_alerts')).error?.code).toBe('42501');
    expect((await healthAlertOf(userId))?.enabled).toBe(true);
  });

  test('S407-14 the website never sees the stop token: only the choice reaches the page', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-token');
    await turnOn(page, userId);
    const token = (await healthAlertOf(userId))?.stop_token ?? '';
    const bodies: Promise<string>[] = [];
    page.on('response', (response: Response) => bodies.push(response.text().catch(() => '')));
    await page.reload();
    await expect(choice(page)).toBeChecked();
    const seen = await Promise.all(bodies);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((body) => body.includes(token))).toEqual([]);
    expect(await page.content()).not.toContain(token);
  });

  test('S407-15 the email holds the handle and fixed words only: nothing of the job, and nothing to resume', async ({
    page,
  }) => {
    const { userId } = await signedIn(page, 'alert-content');
    const device = await withJob(userId, 'Delete posts with the word zebra-4f1c');
    await turnOn(page, userId);
    await report(device, 4);
    const email = await emailOf(userId);
    expect(email?.text).toContain(
      'X warned @ada_x in earnest. Xomoni stopped and won’t resume by itself: only you can, in Xomoni.',
    );
    for (const part of [email?.subject, email?.text, email?.html]) {
      expect(part).not.toContain('zebra-4f1c');
      expect(part).not.toMatch(/resume now|approve|start/i);
    }
  });

  test('S407-16 off by default: a rise queues nothing for someone who didn’t ask', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-default');
    const device = await withJob(userId);
    await openSettings(page);
    await expect(choice(page)).not.toBeChecked();
    await report(device, 3);
    expect(await healthAlertQueueOf(userId)).toEqual([]);
  });

  test('S407-17 with no browser connected yet, Settings still offers the alert', async ({ page }) => {
    await signedIn(page, 'alert-empty');
    await openSettings(page);
    await expect(page.getByRole('region', { name: 'Xomoni’s settings: in Xomoni' })).toBeVisible();
    await expect(choice(page)).toBeEnabled();
  });

  test('S407-18 opening the stop link and leaving without pressing stops nothing', async ({ page, browser }) => {
    const { userId } = await signedIn(page, 'alert-leave');
    await turnOn(page, userId);
    const token = (await healthAlertOf(userId))?.stop_token ?? '';
    const scanner = await browser.newPage();
    await scanner.goto(`/health-alert/stop?token=${token}`);
    await expect(scanner.getByRole('button', { name: 'Stop the alerts' })).toBeVisible();
    await scanner.close();
    expect((await healthAlertOf(userId))?.enabled).toBe(true);
  });

  test('S407-19 turned on, then off again before anything happened: a later rise queues nothing', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-undo');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await choice(page).click();
    await expect.poll(async () => (await healthAlertOf(userId))?.enabled).toBe(false);
    await report(device, 2);
    expect(await healthAlertQueueOf(userId)).toEqual([]);
  });

  test('S407-20 keyboard only: Tab to the switch and Space turns it on, its state read out', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-keys');
    await openSettings(page);
    for (let presses = 0; presses < 80; presses++) {
      if (await choice(page).evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(choice(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(choice(page)).toBeChecked();
    await expect.poll(async () => (await healthAlertOf(userId))?.enabled).toBe(true);
  });

  test('S407-21 Settings and the stop page have no serious accessibility violation, in light and dark', async ({
    page,
  }) => {
    const { userId } = await signedIn(page, 'alert-axe');
    await turnOn(page, userId);
    const token = (await healthAlertOf(userId))?.stop_token ?? '';
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await openSettings(page);
      await expectNoSeriousA11yViolations(page);
      await page.goto(`/health-alert/stop?token=${token}`);
      await expect(page.getByRole('button', { name: 'Stop the alerts' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('S407-22 the card and the stop page fit the screen, with nothing to scroll sideways', async ({ page }) => {
      const { userId } = await signedIn(page, 'alert-phone');
      await turnOn(page, userId);
      const overflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.goto(`/health-alert/stop?token=${(await healthAlertOf(userId))?.stop_token ?? ''}`);
      await expect(page.getByRole('button', { name: 'Stop the alerts' })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  });

  test('S407-23 the choice is kept: a reload, and another browser signed in, show it on', async ({ page, browser }) => {
    const { userId, email } = await signedIn(page, 'alert-kept');
    await turnOn(page, userId);
    await page.reload();
    await expect(choice(page)).toBeChecked();
    const other = await browser.newContext();
    const second = await other.newPage();
    await signIn(second, email, PASSWORD);
    await expectDashboard(second);
    await openSettings(second);
    await expect(choice(second)).toBeChecked();
    await other.close();
  });

  test('S407-24 an account that rested back below Retreat before the send isn’t told', async ({ page }) => {
    const { userId } = await signedIn(page, 'alert-rested');
    const device = await withJob(userId);
    await turnOn(page, userId);
    await report(device, 2);
    await report(device, 0);
    await asDatabase<number>('send_health_alerts');
    const [alert] = await healthAlertQueueOf(userId);
    expect(alert?.sent_at).toBeNull();
    expect(alert?.dropped_at).not.toBeNull();
  });
});
