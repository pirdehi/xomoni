import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// A cleanup planned on xomoni.com (docs/scenarios/235-website-cleanup-plan.md, #235, #345): the three questions of
// Xomoni's Cleanup page, how much the plan matches in Xomoni's copy and how many days it takes, and the hand-over to
// Xomoni, which opens its own Cleanup page with the plan; nothing starts from the website. Xomoni is played at the
// page, as Chrome exposes an extension that lists xomoni.com in `externally_connectable`: it signs in with the site's
// code (`pair_device` on the local stack), answers each estimate as a test says, and records every message.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DAY = 86_400_000;

/** A plan as the page hands it to Xomoni (`CleanupPlan`). */
interface Plan {
  target: string;
  before: number;
  after: number | null;
  keepMinLikes: number | null;
  keepKeywords: string[];
  skipSelfReplies: boolean;
}

/** What the played Xomoni answers. */
interface Answers {
  /** How many items a plan matches in its copy. */
  matching: number;
  /** Whether the account's X archive is imported. */
  archive: boolean;
  /** Refuses every read and plan with this reason. */
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

/** Plays Xomoni in this browser: the one sign-in, estimates and plans; returns what it answers and received. */
async function installFakeXomoni(page: Page, given: Partial<Answers> = {}) {
  const answers: Answers = { matching: 1234, archive: true, refuse: null, ...given };
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
        if (answers.refuse) return { ok: false, reason: answers.refuse };
        if (message.what !== 'cleanup') return { ok: false, reason: 'invalid' };
        return {
          ok: true,
          what: 'cleanup',
          estimate: { handle: 'ada', matching: answers.matching, archive: answers.archive, perDay: 100 },
        };
      case 'xomoni-plan':
        if (answers.refuse) return { ok: false, reason: answers.refuse };
        return message.deviceId === state.connection?.deviceId
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
  return { answers, state, received };
}

/** A new account, signed in, with the played Xomoni in this browser signed in with it; opens Cleanup at `query`. */
async function openCleanup(page: Page, given: Partial<Answers> = {}, query = '') {
  const email = uniqueEmail('plan');
  await createConfirmedUser(email, PASSWORD);
  const fake = await installFakeXomoni(page, given);
  await page.goto(`/#ext=${EXT}`);
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();
  await page.goto(`/dashboard/cleanup${query}`);
  return fake;
}

/** A new account, signed in, in a browser where no Xomoni answers; opens Cleanup. */
async function openCleanupAlone(page: Page) {
  const email = uniqueEmail('plan-alone');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await page.goto('/dashboard/cleanup');
}

/** A choice of what to remove: Posts, Replies, Reposts or Likes. */
const what = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: '1 · What to remove' }).getByRole('radio', { name, exact: true });
/** A choice of how old: 30 days to 2 years, or A date. */
const older = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: '2 · Older than' }).getByRole('radio', { name, exact: true });

/** The Review card. */
const review = (page: Page) => page.getByRole('region', { name: 'Review' });
/** The hand-over button. */
const start = (page: Page) => page.getByRole('button', { name: 'Review and start in Xomoni' });
/** The estimates Xomoni was asked for, newest last. */
const estimates = (received: readonly Record<string, unknown>[]) =>
  received.filter((m) => m.type === 'xomoni-read' && m.what === 'cleanup').map((m) => m.plan as Plan);
/** The plans Xomoni received. */
const plans = (received: readonly Record<string, unknown>[]) => received.filter((m) => m.type === 'xomoni-plan');

/** The start of the local day `days` ago, as the page computes a plan's end. */
function daysAgoStart(days: number): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

/** `YYYY-MM-DD` of the local day `days` from today. */
function dayFromToday(days: number): string {
  const date = new Date(Date.now() + days * DAY);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test.describe('a cleanup planned on xomoni.com', { tag: '@task-235' }, () => {
  test('S235-01 the plan as Xomoni starts it: posts over a year old, what it matches and how many days it takes', async ({
    page,
  }) => {
    const fake = await openCleanup(page);
    await expect(
      page.getByText('Plan here; Xomoni on your computer shows what matches and starts only when you confirm there.'),
    ).toBeVisible();
    await expect(what(page, 'Posts')).toBeChecked();
    await expect(older(page, '1 year')).toBeChecked();
    await expect(review(page)).toContainText('1,234');
    await expect(review(page)).toContainText(
      'posts in Xomoni’s copy of @ada match this plan. Delete them at 100 a day at most: about 13 days.',
    );
    expect(estimates(fake.received).at(-1)).toMatchObject({
      target: 'post',
      before: daysAgoStart(365),
      after: null,
      keepMinLikes: null,
      keepKeywords: [],
      skipSelfReplies: true,
    });
  });

  test('S235-02 Xomoni is asked with exactly the answers: replies, two years, keeping likes and words', async ({
    page,
  }) => {
    const fake = await openCleanup(page);
    await what(page, 'Replies').check();
    await older(page, '2 years').check();
    await page.getByRole('spinbutton', { name: /Keep if it has at least … likes/ }).fill('10');
    await page.getByRole('textbox', { name: /Keep if the text contains/ }).fill('Launch, thanks\nlaunch');
    await page.getByRole('switch', { name: 'Keep replies to your own posts (threads)' }).uncheck();
    await expect
      .poll(() => estimates(fake.received).at(-1))
      .toMatchObject({
        target: 'reply',
        before: daysAgoStart(730),
        keepMinLikes: 10,
        keepKeywords: ['launch', 'thanks'],
        skipSelfReplies: false,
      });
  });

  test('S235-03 Review and start in Xomoni hands the plan over, which opens Xomoni’s Cleanup and starts nothing', async ({
    page,
  }) => {
    const fake = await openCleanup(page);
    await what(page, 'Likes').check();
    await expect(review(page)).toContainText('likes in Xomoni’s copy');
    await start(page).click();
    await expect(
      page.getByText(
        /Xomoni opened its Cleanup page with your plan\. Review it there and press Start: nothing starts until you confirm in Xomoni\./,
      ),
    ).toBeVisible();
    expect(plans(fake.received)).toHaveLength(1);
    expect(plans(fake.received)[0]).toMatchObject({
      deviceId: fake.state.connection?.deviceId,
      plan: { target: 'like', keepMinLikes: null },
    });
    expect(fake.received.filter((m) => m.type === 'xomoni-job')).toEqual([]);
  });

  test('S235-04 the answers live in the address, so a link opens the same plan', async ({ page }) => {
    const fake = await openCleanup(page);
    await what(page, 'Replies').check();
    await older(page, '90 days').check();
    await page.getByRole('spinbutton', { name: /Keep if it has at least … likes/ }).fill('5');
    await expect(page).toHaveURL(/\/dashboard\/cleanup\?what=reply&older=90d&likes=5$/);
    const link = page.url();
    await page.goto('/dashboard');
    await page.goto(link);
    await expect(what(page, 'Replies')).toBeChecked();
    await expect(older(page, '90 days')).toBeChecked();
    await expect(page.getByRole('spinbutton', { name: /Keep if it has at least … likes/ })).toHaveValue('5');
    await expect.poll(() => estimates(fake.received).at(-1)?.keepMinLikes).toBe(5);
  });

  test('S235-05 a date still to come is refused, and nothing can be handed over', async ({ page }) => {
    await openCleanup(page);
    await older(page, 'A date').check();
    await page.getByLabel('Remove everything before').fill(dayFromToday(5));
    await expect(review(page)).toContainText('The date must be today or earlier.');
    await expect(start(page)).toBeDisabled();
  });

  test('S235-06 a start date on or after the end date is refused', async ({ page }) => {
    await openCleanup(page);
    await older(page, 'A date').check();
    await page.getByLabel('Remove everything before').fill('2022-01-01');
    await page.getByLabel(/Only from/).fill('2023-01-01');
    await expect(review(page)).toContainText('The start date must be before the end date.');
    await expect(start(page)).toBeDisabled();
  });

  test('S235-07 likes to keep must be a whole number from 1: 0 is refused', async ({ page }) => {
    await openCleanup(page);
    await page.getByRole('spinbutton', { name: /Keep if it has at least … likes/ }).fill('0');
    await expect(review(page)).toContainText('Likes to keep must be a whole number from 1, or empty.');
    await expect(start(page)).toBeDisabled();
  });

  test('S235-08 more than 20 words to keep, or one over 50 characters, is refused', async ({ page }) => {
    await openCleanup(page);
    const words = page.getByRole('textbox', { name: /Keep if the text contains/ });
    await words.fill(Array.from({ length: 21 }, (_, i) => `word${i}`).join(', '));
    await expect(review(page)).toContainText('Keep at most 20 words or phrases.');
    await words.fill('x'.repeat(51));
    await expect(review(page)).toContainText('Each word or phrase to keep can be at most 50 characters.');
    await expect(start(page)).toBeDisabled();
  });

  test('S235-09 a day before X began, in 2006, is refused', async ({ page }) => {
    await openCleanup(page);
    await older(page, 'A date').check();
    await page.getByLabel('Remove everything before').fill('2005-06-01');
    await expect(review(page)).toContainText('X began in 2006: pick a day from then on.');
  });

  test('S235-10 when Xomoni refuses to count, the page says it didn’t answer', async ({ page }) => {
    await openCleanup(page, { refuse: 'busy' });
    await expect(review(page)).toContainText('Xomoni didn’t answer. Open it on this computer and try again.');
  });

  test('S235-11 a Xomoni older than the page says to install the newest version', async ({ page }) => {
    await openCleanup(page, { refuse: 'invalid' });
    await expect(review(page)).toContainText(
      'Your Xomoni is older than this page and can’t count what matches here yet.',
    );
  });

  test('S235-12 a plan Xomoni refuses says why, and nothing starts', async ({ page }) => {
    const fake = await openCleanup(page);
    await expect(review(page)).toContainText('1,234');
    fake.answers.refuse = 'other_account';
    await start(page).click();
    await expect(page.getByText('Xomoni in this browser isn’t signed in to this account.')).toBeVisible();
    expect(fake.received.filter((m) => m.type === 'xomoni-job')).toEqual([]);
  });

  test('S235-13 only estimates and the plan go to Xomoni: no job is started, resumed or approved from the page', async ({
    page,
  }) => {
    const fake = await openCleanup(page);
    await what(page, 'Reposts').check();
    await start(page).click();
    await expect(page.getByText(/Xomoni opened its Cleanup page/)).toBeVisible();
    expect(new Set(fake.received.map((m) => m.type))).toEqual(
      new Set(['xomoni-hello', 'xomoni-sign-in', 'xomoni-read', 'xomoni-plan']),
    );
    expect(Object.keys((plans(fake.received)[0]?.plan ?? {}) as Record<string, unknown>).sort()).toEqual([
      'after',
      'before',
      'keepKeywords',
      'keepMinLikes',
      'skipSelfReplies',
      'target',
    ]);
  });

  test('S235-14 the words to keep never reach a server: they go only to Xomoni in this browser', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (request: Request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    const fake = await openCleanup(page);
    await page.getByRole('textbox', { name: /Keep if the text contains/ }).fill('secretword-7d2e');
    await expect.poll(() => estimates(fake.received).at(-1)?.keepKeywords).toEqual(['secretword-7d2e']);
    await start(page).click();
    await expect(page.getByText(/Xomoni opened its Cleanup page/)).toBeVisible();
    // The page's own address carries the answers; no request to any server does, beyond loading the page itself.
    expect(sent.filter((line) => line.includes('secretword-7d2e') && !line.includes('/dashboard/cleanup'))).toEqual([]);
  });

  test('S235-15 a link with a plan only fills the form: nothing goes to Xomoni until the person presses', async ({
    page,
  }) => {
    const fake = await openCleanup(page, {}, '?what=like&older=30d');
    await expect(what(page, 'Likes')).toBeChecked();
    await expect(review(page)).toContainText('1,234');
    expect(plans(fake.received)).toEqual([]);
  });

  test('S235-16 without Xomoni here, the page says where it counts, and Review opens the install dialog', async ({
    page,
  }) => {
    await openCleanupAlone(page);
    await expect(review(page)).toContainText(
      'Xomoni counts what matches on your computer: open this page in the browser where Xomoni runs to see it here.',
    );
    await start(page).click();
    await expect(page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' })).toBeVisible();
  });

  test('S235-17 a plan nothing matches says 0, with no days to take', async ({ page }) => {
    await openCleanup(page, { matching: 0 });
    await expect(review(page)).toContainText('0');
    await expect(review(page)).toContainText('posts in Xomoni’s copy of @ada match this plan.');
    await expect(review(page)).not.toContainText('a day at most');
  });

  test('S235-18 putting the answers back to the defaults gives a plain address again', async ({ page }) => {
    await openCleanup(page);
    await what(page, 'Replies').check();
    await expect(page).toHaveURL(/\?what=reply$/);
    await what(page, 'Posts').check();
    await expect(page).toHaveURL(/\/dashboard\/cleanup$/);
  });

  test('S235-19 closing the dialog after Review hands nothing over', async ({ page }) => {
    await openCleanupAlone(page);
    await start(page).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(start(page)).toBeEnabled();
  });

  test('S235-20 keyboard only: arrows choose what to remove and how old, and Enter hands the plan over', async ({
    page,
  }) => {
    const fake = await openCleanup(page);
    const posts = what(page, 'Posts');
    await posts.focus();
    await page.keyboard.press('ArrowRight');
    await expect(what(page, 'Replies')).toBeChecked();
    await older(page, '1 year').focus();
    await page.keyboard.press('ArrowRight');
    await expect(older(page, '2 years')).toBeChecked();
    await start(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Xomoni opened its Cleanup page/)).toBeVisible();
    expect(plans(fake.received)[0]).toMatchObject({ plan: { target: 'reply', before: daysAgoStart(730) } });
  });

  test('S235-21 the plan and its estimate have no serious accessibility violation, in light and dark', async ({
    page,
  }) => {
    await openCleanup(page, { archive: false });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(review(page)).toContainText('No X archive imported');
      await expectNoSeriousA11yViolations(page);
    }
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('S235-22 Review says Xomoni runs on a computer, and Send to my computer carries the plan in the link', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
        Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined });
      });
      await openCleanupAlone(page);
      await what(page, 'Likes').check();
      await expect(page).toHaveURL(/\?what=like$/);
      await start(page).click();
      const dialog = page.getByRole('dialog', { name: 'Xomoni runs on a computer' });
      await dialog.getByRole('button', { name: 'Send to my computer' }).click();
      await expect(dialog.getByRole('status')).toContainText('Link copied.');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/dashboard\/cleanup\?what=like$/);
    });
  });

  test('S235-23 a reload keeps the plan, from the address', async ({ page }) => {
    await openCleanup(page);
    await what(page, 'Likes').check();
    await older(page, '6 months').check();
    await expect(page).toHaveURL(/\?what=like&older=6m$/);
    await page.reload();
    await expect(what(page, 'Likes')).toBeChecked();
    await expect(older(page, '6 months')).toBeChecked();
  });

  test('S235-24 without the X archive, the estimate warns that old items can be missed, but not for reposts', async ({
    page,
  }) => {
    await openCleanup(page, { archive: false });
    await expect(review(page)).toContainText(
      'No X archive imported: old posts X no longer shows can be missed. Get your archive in Xomoni’s Library first.',
    );
    await what(page, 'Reposts').check();
    await expect(review(page)).toContainText('reposts in Xomoni’s copy');
    await expect(review(page)).not.toContainText('No X archive imported');
  });
});
