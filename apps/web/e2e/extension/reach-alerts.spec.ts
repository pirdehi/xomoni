import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT } from '../support/x-fixtures';

// Reach's alerts (docs/scenarios/523-reach-alerts.md, #523, part of #430's P5.3): a label new or larger than the month
// before, in a report dropped on the Vault page, is noted once per month, and the menu counts the months not yet seen
// on Reach; a note on Reach when the last 7 days' views fall under 0.6 of the 8 weeks before, from the daily numbers,
// always an estimate; and *Tell me when my reach drops*, off unless turned on. The built extension in a real browser,
// on x.com served from synthetic fixtures (ADR-0040); the daily numbers and this week's posts are put straight into
// Xomoni's database, as days of browsing leave them.

const DAY = 86_400_000;
const UNDER_THE_HOOD = path.join(__dirname, '..', 'fixtures', 'under-the-hood');
const report = (file: string) => readFileSync(path.join(UNDER_THE_HOOD, file), 'utf8');
const jsonUpload = (name: string, text: string) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

/** Puts records into one of Xomoni's stores, as Xomoni's own writes leave them. */
async function put(dashboard: Page, store: string, records: readonly unknown[]) {
  await dashboard.evaluate(
    ([name, rows]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const tx = open.result.transaction(name, 'readwrite');
          for (const row of rows) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(new Error(String(tx.error)));
        };
      }),
    [store, records] as const,
  );
}

/** Reads one `kv` value. */
async function kv(dashboard: Page, key: string): Promise<unknown> {
  return dashboard.evaluate(
    (k) =>
      new Promise((resolve) => {
        const open = indexedDB.open('xomoni');
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get(k);
          get.onsuccess = () => {
            open.result.close();
            resolve((get.result as { value?: unknown } | undefined)?.value ?? null);
          };
        };
      }),
    key,
  );
}

/** A local `yyyy-mm-dd` day, `daysAgo` days back, as the daily numbers name it. */
const localDay = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Nine weeks of daily numbers, 1,000 views a day and `recent` a day for the last `recentDays`, and `posts` of the
 * account's posts made in the last 7 days; then the dashboard reloads.
 */
async function seedWeek(dashboard: Page, recent: number, posts: number, recentDays = 7) {
  const now = Date.now();
  await put(
    dashboard,
    'daily',
    Array.from({ length: 63 }, (_, i) => i).flatMap((i) =>
      i < 7 && i >= recentDays
        ? []
        : [
            {
              accountId: FIXTURE_ACCOUNT.id,
              day: localDay(i),
              followers: null,
              following: null,
              postsTotal: null,
              likesTotal: null,
              receivedViews: i < 7 ? recent : 1_000,
              updatedAt: now,
            },
          ],
    ),
  );
  await put(
    dashboard,
    'items',
    Array.from({ length: posts }, (_, i) => {
      const id = `9000000000000007${String(i).padStart(3, '0')}`;
      return {
        key: `${FIXTURE_ACCOUNT.id}:post:${id}`,
        accountId: FIXTURE_ACCOUNT.id,
        kind: 'post',
        id,
        targetId: id,
        createdAt: now - (i + 1) * 3_600_000,
        likedAt: null,
        text: `This week's post ${String(i)}`,
        author: FIXTURE_ACCOUNT.handle,
        inReplyToId: null,
        selfReply: false,
        likes: 0,
        reposts: 0,
        replies: 0,
        sources: ['scan'],
        status: 'present',
        seenAt: now,
        statusAt: now,
        lastJobId: null,
      };
    }),
  );
  await dashboard.reload();
}

/** The person's start: the X window open and their posts browsed, so Xomoni knows the account. */
async function start(dashboard: Page, page: Page) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await dashboard.bringToFront();
}

const menu = (dashboard: Page): Locator =>
  dashboard.getByRole('navigation').getByRole('button', { name: 'Reach', exact: true });

async function openPage(dashboard: Page, name: 'Reach' | 'Vault') {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Chooses `files` on the Vault page and imports them, saying they are the person's when asked. */
async function importReports(dashboard: Page, files: ReturnType<typeof jsonUpload>[], confirm = true) {
  await openPage(dashboard, 'Vault');
  const chooser = dashboard.waitForEvent('filechooser');
  await dashboard.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles(files);
  const plan = dashboard.getByRole('dialog', { name: 'Import these files?' });
  if (confirm) for (const box of await plan.getByRole('checkbox').all()) await box.check();
  await plan.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dashboard.getByRole('status', { name: 'What came in' })).toBeVisible();
}

const AUGUST = () => jsonUpload('under_the_hood.json', report('aug-2026.json'));
const alerted = (dashboard: Page) => kv(dashboard, `labelAlerted:${FIXTURE_ACCOUNT.id}`);
const dropNote = (dashboard: Page) =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { name: 'Your views fell this week' }) });
const toggle = (dashboard: Page) => dashboard.getByRole('switch', { name: 'Tell me when my reach drops' });

test.describe('Reach’s alerts', { tag: '@task-523' }, () => {
  test('S523-01 a report with a new label is noted once, and the menu counts its month', async ({
    dashboard,
    page,
  }) => {
    await start(dashboard, page);
    await importReports(dashboard, [AUGUST()]);
    await expect.poll(() => alerted(dashboard)).toEqual(['2026-08']);
    await expect(menu(dashboard)).toHaveAttribute('aria-description', "1 new month of X's labels");
    await expect(menu(dashboard)).toContainText('1');
  });

  test('S523-02 opening Reach clears the menu’s count', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await importReports(dashboard, [AUGUST()]);
    await expect(menu(dashboard)).toHaveAttribute('aria-description', /1 new month/);
    await openPage(dashboard, 'Reach');
    await expect(menu(dashboard)).not.toHaveAttribute('aria-description');
  });

  test('S523-03 views under 0.6 of the usual, with 6 posts this week, make a note, as an estimate', async ({
    dashboard,
    page,
  }) => {
    await start(dashboard, page);
    await seedWeek(dashboard, 400, 6);
    await openPage(dashboard, 'Reach');
    await expect(dropNote(dashboard)).toContainText('40% of your usual');
    await expect(dropNote(dashboard)).toContainText('Estimate');
    await expect(dropNote(dashboard)).toContainText('What may go with it, not why:');
  });

  test('S523-04 Tell me when my reach drops is off until turned on, and stays on', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await seedWeek(dashboard, 400, 6);
    await openPage(dashboard, 'Reach');
    await expect(toggle(dashboard)).not.toBeChecked();
    // The switch shows what is kept, so it turns once the choice is written.
    await toggle(dashboard).click();
    await expect(toggle(dashboard)).toBeChecked();
    await expect.poll(() => kv(dashboard, `reachDropAlerts:${FIXTURE_ACCOUNT.id}`)).toBe(true);
    await dashboard.reload();
    await openPage(dashboard, 'Reach');
    await expect(toggle(dashboard)).toBeChecked();
  });

  test('S523-05 the same report again is not noted a second time', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await importReports(dashboard, [AUGUST()]);
    await importReports(dashboard, [jsonUpload('under_the_hood (1).json', report('aug-2026.json'))], false);
    await expect.poll(() => alerted(dashboard)).toEqual(['2026-08']);
  });

  test('S523-06 a newer file of the same month is not noted again either', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await importReports(dashboard, [AUGUST()]);
    const newer = report('aug-2026.json').replace('"posts": 3', '"posts": 5');
    await importReports(dashboard, [jsonUpload('aug-again.json', newer)]);
    await expect.poll(() => alerted(dashboard)).toEqual(['2026-08']);
  });

  test('S523-07 with only 4 posts this week, fewer posts is the reason: no note', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await seedWeek(dashboard, 400, 4);
    await openPage(dashboard, 'Reach');
    await expect(dashboard.getByText('When your reach drops')).toBeVisible();
    await expect(dropNote(dashboard)).toHaveCount(0);
  });

  test('S523-08 a JSON that isn’t X’s report is refused, and nothing is noted', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await openPage(dashboard, 'Vault');
    const chooser = dashboard.waitForEvent('filechooser');
    await dashboard.getByRole('button', { name: 'Choose files' }).click();
    await (await chooser).setFiles([jsonUpload('list.json', '{"items":["bread"]}')]);
    const plan = dashboard.getByRole('dialog', { name: 'Import these files?' });
    await expect(plan.getByRole('list', { name: 'Not imported' })).toContainText('This isn’t X’s Under the hood file.');
    await plan.getByRole('button', { name: 'Cancel' }).click();
    expect(await alerted(dashboard)).toBeNull();
    await expect(menu(dashboard)).not.toHaveAttribute('aria-description');
  });

  test('S523-09 with fewer than 4 days of numbers this week, no note is made', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await seedWeek(dashboard, 100, 6, 3);
    await openPage(dashboard, 'Reach');
    await expect(dashboard.getByText('When your reach drops')).toBeVisible();
    await expect(dropNote(dashboard)).toHaveCount(0);
  });

  test('S523-10 a report naming another account is refused, and nothing is noted', async ({ dashboard, page }) => {
    await start(dashboard, page);
    const theirs = JSON.stringify({
      ...(JSON.parse(report('aug-2026.json')) as object),
      screen_name: FRIEND_ACCOUNT.handle,
    });
    await openPage(dashboard, 'Vault');
    const chooser = dashboard.waitForEvent('filechooser');
    await dashboard.getByRole('button', { name: 'Choose files' }).click();
    await (await chooser).setFiles([jsonUpload('theirs.json', theirs)]);
    const plan = dashboard.getByRole('dialog', { name: 'Import these files?' });
    await expect(plan.getByRole('list', { name: 'Not imported' })).toContainText('another account’s');
    await plan.getByRole('button', { name: 'Cancel' }).click();
    expect(await alerted(dashboard)).toBeNull();
  });

  test('S523-11 nothing leaves the computer while a report is noted and the drop is read', async ({
    dashboard,
    page,
    context,
  }) => {
    await start(dashboard, page);
    const sent = requestsOut(context);
    await importReports(dashboard, [AUGUST()]);
    await seedWeek(dashboard, 400, 6);
    await openPage(dashboard, 'Reach');
    await expect(dropNote(dashboard)).toBeVisible();
    expect(sent.filter((url) => !url.startsWith('https://x.com/') && !url.includes('twimg.com'))).toEqual([]);
  });

  test('S523-12 a label’s name in markup stays text on Reach after it is noted', async ({ dashboard, page }) => {
    await start(dashboard, page);
    const marked = report('aug-2026.json').replace('SYNTHETIC_UNKNOWN_LABEL', '<img src=x onerror=alert(1)>');
    await importReports(dashboard, [jsonUpload('marked.json', marked)]);
    await openPage(dashboard, 'Reach');
    await expect(dashboard.getByText('<img src=x onerror=alert(1)>').first()).toBeVisible();
    await expect(dashboard.locator('img[src="x"]')).toHaveCount(0);
  });

  test('S523-13 another account’s months never count in this account’s menu', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await put(dashboard, 'labelMonths', [
      {
        accountId: FRIEND_ACCOUNT.id,
        month: '2026-08',
        importedAt: Date.now() - DAY,
        labels: [{ name: 'A', count: 1, scope: 'posts' }],
      },
    ]);
    await dashboard.reload();
    await expect(menu(dashboard)).toBeVisible();
    await expect(menu(dashboard)).not.toHaveAttribute('aria-description');
  });

  test('S523-14 a report with no label notes nothing, and the menu counts nothing', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await importReports(dashboard, [jsonUpload('empty.json', report('empty-month.json'))]);
    expect(await alerted(dashboard)).toBeNull();
    await expect(menu(dashboard)).not.toHaveAttribute('aria-description');
  });

  test('S523-15 without daily numbers, Reach only offers the switch', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await openPage(dashboard, 'Reach');
    await expect(dashboard.getByText('When your reach drops')).toBeVisible();
    await expect(toggle(dashboard)).not.toBeChecked();
    await expect(dropNote(dashboard)).toHaveCount(0);
  });

  test('S523-16 turning the switch off again keeps it off after a reload', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await seedWeek(dashboard, 400, 6);
    await openPage(dashboard, 'Reach');
    await toggle(dashboard).click();
    await expect(toggle(dashboard)).toBeChecked();
    await toggle(dashboard).click();
    await expect(toggle(dashboard)).not.toBeChecked();
    await dashboard.reload();
    await openPage(dashboard, 'Reach');
    await expect(toggle(dashboard)).not.toBeChecked();
  });

  test('S523-17 Cancel in the import’s plan imports nothing, and nothing is noted', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await openPage(dashboard, 'Vault');
    const chooser = dashboard.waitForEvent('filechooser');
    await dashboard.getByRole('button', { name: 'Choose files' }).click();
    await (await chooser).setFiles([AUGUST()]);
    await dashboard
      .getByRole('dialog', { name: 'Import these files?' })
      .getByRole('button', { name: 'Cancel' })
      .click();
    expect(await alerted(dashboard)).toBeNull();
    await expect(menu(dashboard)).not.toHaveAttribute('aria-description');
  });

  test('S523-18 the drop note has no serious accessibility violation in light mode', async ({ dashboard, page }) => {
    await start(dashboard, page);
    await seedWeek(dashboard, 400, 6);
    await openPage(dashboard, 'Reach');
    await expect(dropNote(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S523-19 the menu’s count and the switch read well, and the switch works with the keyboard', async ({
      dashboard,
      page,
    }) => {
      await start(dashboard, page);
      await importReports(dashboard, [AUGUST()]);
      await seedWeek(dashboard, 400, 6);
      await expect(menu(dashboard)).toHaveAttribute('aria-description', /1 new month/);
      await expectNoSeriousA11yViolations(dashboard);
      await openPage(dashboard, 'Reach');
      await tabTo(toggle(dashboard), 200);
      await dashboard.keyboard.press('Space');
      await expect(toggle(dashboard)).toBeChecked();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S523-20 at a phone’s width the note fits, and the page doesn’t scroll sideways', async ({
    dashboard,
    page,
  }) => {
    await start(dashboard, page);
    await seedWeek(dashboard, 400, 6);
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await openPage(dashboard, 'Reach');
    await expect(dropNote(dashboard)).toBeVisible();
    expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('S523-21 the menu’s count stays after a reload until Reach is opened, and stays gone after', async ({
    dashboard,
    page,
  }) => {
    await start(dashboard, page);
    await importReports(dashboard, [AUGUST()]);
    await dashboard.reload();
    await expect(menu(dashboard)).toHaveAttribute('aria-description', /1 new month/);
    await openPage(dashboard, 'Reach');
    await dashboard.reload();
    await expect(menu(dashboard)).toBeVisible();
    await expect(menu(dashboard)).not.toHaveAttribute('aria-description');
  });
});

/** Every request `context` sends from now on that isn't to Xomoni itself. */
function requestsOut(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request) => {
    if (!request.url().startsWith('chrome-extension://')) sent.push(request.url());
  });
  return sent;
}
