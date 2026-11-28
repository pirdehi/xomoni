import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { EXTENSION_DIR_ENV } from '../support/build-extension';
import {
  acceptRisks,
  browseProfile,
  confirmCleanup,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  removeBefore,
  risksDialog,
  startCleanup,
  workAnyTime,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, servePage } from '../support/x-fixtures';

// Move your data to a new Xomoni (docs/scenarios/300-move-your-data.md, ADR-0032, #300, #345): *Export everything* in
// one Xomoni, *Import from a file* in another, in the built extension in real browsers, on x.com served from synthetic
// fixtures (ADR-0040). The new Xomoni is a fresh install in a browser of its own (`newXomoni`), as Chrome keeps each
// copy's data apart. Hand-made files are the exported one changed in Node, with the checksum written again where the
// scenario is about a file that is whole but not what Xomoni writes.

/** The version of the Xomoni under test, as its manifest says: the version an export names. */
const VERSION = (
  JSON.parse(readFileSync(path.join(process.env[EXTENSION_DIR_ENV] ?? '', 'manifest.json'), 'utf8')) as {
    version: string;
  }
).version;

/** `text` as a regular expression that matches it as it is. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text of the fixture account's two posts, newest first, as the Library lists them. */
const POSTS = ["Another made-up post, with no one's words in it.", "A made-up post for Xomoni's browser tests."];

/** The tables of version 1 of the move file, in its order (`CORE_MOVE_TABLES` in `apps/extension/src/shared/move-file.ts`). */
const CORE_TABLES = [
  'accounts',
  'items',
  'jobs',
  'logs',
  'limits',
  'reads',
  'risk',
  'checks',
  'daily',
  'incoming',
  'kv',
];

/** The vault's tables, which version 2 adds after the core ones (`VAULT_TABLE_NAMES`, #424). */
const VAULT_TABLES = ['vaultImports', 'analyticsPosts', 'analyticsDays', 'accountEvents'];

/** The tables a move file carries, in its order (`MOVE_TABLES` in `apps/extension/src/shared/move-file.ts`). */
const TABLES = [...CORE_TABLES, ...VAULT_TABLES];

/** What a move file says about itself, which its checksum covers with the data. */
interface MoveHeader {
  format: string;
  version: number;
  app: string;
  exportedAt: string;
}

/** What a file from *Export everything* holds (`apps/extension/src/shared/move-file.ts`), as the tests read it. */
interface MoveFile extends MoveHeader {
  checksum: string;
  data: Record<string, Record<string, unknown>[] | undefined>;
}

/** A file saved by *Export everything*: its name in Downloads, where Playwright keeps it, and what it holds. */
interface Exported {
  name: string;
  path: string;
  text: string;
  file: MoveFile;
}

/** The records of `table` in `file`; fails the test when the file doesn't have that table. */
function rows(file: MoveFile, table: string): Record<string, unknown>[] {
  const found = file.data[table];
  if (!found) throw new Error(`The file has no ${table} table`);
  return found;
}

/** The checksum Xomoni writes into a move file: SHA-256 of its header and data, as `moveChecksum` computes it. */
function checksumOf({ format, version, app, exportedAt, data }: MoveHeader & { data: unknown }): string {
  const text = JSON.stringify({ format, version, app, exportedAt, data });
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/** `file` changed by hand and sealed again with its checksum, as another tool would write it: whole, but not Xomoni's. */
function sealed<T extends MoveHeader & { data: unknown }>(file: T): T & { checksum: string } {
  return { ...file, checksum: checksumOf(file) };
}

/** A file to pick in the browser's file chooser, named as Xomoni names an export unless `name` says otherwise. */
function upload(content: unknown, name = 'xomoni-export-handmade.json') {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return { name, mimeType: 'application/json', buffer: Buffer.from(text) };
}

/** Today in this computer's time zone, as Xomoni dates the file's name (`YYYY-MM-DD`). */
function today(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Settings' card *Move your data*. */
const moveCard = (dashboard: Page): Locator =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { level: 2, name: 'Move your data' }) });

/** The offer on a new install, on the welcome page and on Home: *Coming from another Xomoni?*, or the import's result. */
const offer = (dashboard: Page): Locator => dashboard.getByRole('region', { name: 'Move your data' });

/** *Import this data?*, the confirmation that shows what a checked file holds. */
const importDialog = (dashboard: Page): Locator => dashboard.getByRole('dialog', { name: 'Import this data?' });

/** The alert a refused file shows, *Not imported*, with why. */
const refusal = (dashboard: Page): Locator => dashboard.getByRole('alert').filter({ hasText: 'Not imported' });

/** The import's result, *Your data is here*, which stays until the person dismisses it (#357). */
const imported = (dashboard: Page): Locator => dashboard.getByRole('status').filter({ hasText: 'Your data is here' });

/** The dashboard's toasts. */
const toasts = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'Notifications' });

/** The rows of the Library's table, newest first. */
const libraryRows = (dashboard: Page): Locator =>
  dashboard.getByRole('table').getByRole('rowgroup').nth(1).getByRole('row');

/** Opens Settings and presses *Export everything*, and returns the file the browser saved. */
async function exportEverything(dashboard: Page): Promise<Exported> {
  await openPage(dashboard, 'Settings');
  const saved = dashboard.waitForEvent('download');
  await moveCard(dashboard).getByRole('button', { name: 'Export everything' }).click();
  const download = await saved;
  const where = await download.path();
  const text = readFileSync(where, 'utf8');
  return { name: download.suggestedFilename(), path: where, text, file: JSON.parse(text) as MoveFile };
}

/**
 * The person's usual start: the X window open, their profile's posts browsed, so Xomoni has a copy of the account;
 * then *Export everything*.
 */
async function exportedCopy(dashboard: Page, page: Page): Promise<Exported> {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  return exportEverything(dashboard);
}

/** Presses `button`, as the person does, and picks `file` in the file chooser it opens. */
async function pick(button: Locator, file: string | ReturnType<typeof upload>) {
  const chooser = button.page().waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles(file);
}

/** Every request `context`'s pages send from now on, as `METHOD url`, as they go. */
function requestsOf(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request) => sent.push(`${request.method()} ${request.url()}`));
  return sent;
}

/** Opens the Library and waits for its table. */
async function openLibrary(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
}

/** The job a cleanup of the fixture account's two posts, both before Jan 1, 2022, becomes. */
const BEFORE_2022 = 'Delete posts older than Jan 1, 2022';

/**
 * A cleanup of the account's two posts started, with the risks read and accepted, that waits for active hours two hours
 * from now: the job hasn't finished. The X window is open and the posts browsed unless `browsed` says they are already.
 * Returns the job's card under Activity.
 */
async function waitingCleanup(dashboard: Page, page: Page, { browsed = false } = {}): Promise<Locator> {
  if (!browsed) {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
  }
  const hour = await dashboard.evaluate(() => new Date().getHours());
  await openPage(dashboard, 'Settings');
  await dashboard.getByRole('combobox', { name: 'From' }).selectOption(String((hour + 2) % 24));
  await dashboard.getByRole('combobox', { name: 'Until' }).selectOption(String((hour + 3) % 24));
  await expect(dashboard.getByRole('combobox', { name: 'Until' })).toHaveValue(String((hour + 3) % 24));
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2022-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
  await continueWithoutArchive(dashboard);
  await confirmCleanup(dashboard);
  await acceptRisks(dashboard);
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  const card = jobCard(dashboard, BEFORE_2022);
  await expect(card).toContainText('Outside active hours');
  return card;
}

test.describe('move your data to a new Xomoni', { tag: '@task-300' }, () => {
  // Most tests run two browsers, one for each Xomoni, and S300-04 three: twice the time a test with one may take.
  test.describe.configure({ timeout: 60_000 });

  test('S300-01 Export everything saves one checked file in Downloads, with the account and its posts', async ({
    dashboard,
    page,
  }) => {
    const { name, file } = await exportedCopy(dashboard, page);

    expect(name).toBe(`xomoni-export-${today()}.json`);
    await expect(toasts(dashboard)).toContainText(
      `Saved ${name}. It stays on your computer: Xomoni never sends it anywhere.`,
    );
    expect(file).toMatchObject({ format: 'xomoni-export', version: 2, app: VERSION });
    expect(Date.parse(file.exportedAt)).toBeGreaterThan(Date.now() - 60_000);
    // The checksum covers the header and the data, so a change anywhere shows.
    expect(file.checksum).toBe(checksumOf(file));
    expect(Object.keys(file.data)).toEqual(TABLES);
    expect(rows(file, 'accounts')).toEqual([
      expect.objectContaining({ id: FIXTURE_ACCOUNT.id, handle: FIXTURE_ACCOUNT.handle, name: FIXTURE_ACCOUNT.name }),
    ]);
    expect(
      rows(file, 'items')
        .map((item) => item.text)
        .sort(),
    ).toEqual([...POSTS].sort());
  });

  test('S300-02 a new Xomoni offers the import on its first run, and the account arrives with its posts', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const exported = await exportedCopy(dashboard, page);
    const { dashboard: fresh } = await newXomoni();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(offer(fresh)).toContainText('Coming from another Xomoni?');

    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), exported.path);
    const dialog = importDialog(fresh);
    const day = new Date(exported.file.exportedAt).toLocaleDateString('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    await expect(dialog).toContainText(
      `From Xomoni ${VERSION}, exported ${day}. The file is complete: its checksum matches.`,
    );
    await expect(dialog.getByRole('list', { name: 'Accounts in the file' })).toHaveText(
      `@${FIXTURE_ACCOUNT.handle}: 2 posts, replies and reposts · 0 likes · 0 jobs · 0 log entries`,
    );
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();

    // The dashboard turns to Home at once, for the account the file brought, with no X window opened.
    await expect(fresh.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(fresh.getByRole('main')).toContainText(`@${FIXTURE_ACCOUNT.handle} · everything Xomoni knows`);
    await expect(imported(fresh)).toContainText(
      new RegExp(
        `Imported from Xomoni ${escapeRegExp(VERSION)}\\. Added \\d+ records and updated 0 with newer copies\\. Nothing was replaced with less or deleted, and nothing started on X\\.`,
      ),
    );
    await expect(fresh.getByRole('region', { name: 'Counts' })).toContainText(/Posts\s*2/);
    await openLibrary(fresh);
    await expect(libraryRows(fresh)).toHaveCount(2);
    await expect(libraryRows(fresh).nth(0)).toContainText(POSTS[0]!);
    await expect(libraryRows(fresh).nth(1)).toContainText(POSTS[1]!);
  });

  test('S300-03 Import from a file in Settings adds to an account already here, and a second import adds nothing', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const exported = await exportedCopy(dashboard, page);
    // The new Xomoni already knows the account, by its handle only, from its own X window.
    const { dashboard: fresh } = await newXomoni();
    await openXWindow(fresh);
    await openPage(fresh, 'Settings');
    await pick(moveCard(fresh).getByRole('button', { name: 'Import from a file' }), exported.path);
    await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(importDialog(fresh)).toBeHidden();

    // The file's copy of the account is older, so it only fills in what this one didn't know yet, such as the name.
    await expect(imported(moveCard(fresh).page())).toContainText(
      /Added \d+ records and updated 1 with newer copies\. Nothing was replaced with less or deleted, and nothing started on X\./,
    );
    await expect(
      fresh
        .getByRole('complementary')
        .getByRole('button', { name: `${FIXTURE_ACCOUNT.name} @${FIXTURE_ACCOUNT.handle}` }),
    ).toBeVisible();
    await openLibrary(fresh);
    await expect(libraryRows(fresh)).toHaveCount(2);

    // The same file again: everything in it is here already.
    await openPage(fresh, 'Settings');
    await moveCard(fresh).getByRole('button', { name: 'Dismiss' }).click();
    await pick(moveCard(fresh).getByRole('button', { name: 'Import from a file' }), exported.path);
    await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(fresh)).toContainText(
      'Everything in the file was already here. Nothing was replaced with less or deleted, and nothing started on X.',
    );
    await openLibrary(fresh);
    await expect(libraryRows(fresh)).toHaveCount(2);
  });

  test('S300-04 the settings come along, and settings the new Xomoni already has stay as they are', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('switch', { name: 'Only work during active hours' }).click();
    await expect(dashboard.getByRole('switch', { name: 'Only work during active hours' })).not.toBeChecked();
    await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
    await dashboard.getByRole('spinbutton', { name: 'Delete posts & replies, Per day' }).fill('100');
    await expect(dashboard.getByRole('spinbutton', { name: 'Delete posts & replies, Per day' })).toHaveValue('100');
    const exported = await exportEverything(dashboard);

    // A new Xomoni, with nothing set yet: the settings arrive as they were.
    const first = (await newXomoni()).dashboard;
    await pick(offer(first).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(first).getByRole('button', { name: 'Import', exact: true }).click();
    await openPage(first, 'Settings');
    await expect(first.getByRole('switch', { name: 'Only work during active hours' })).not.toBeChecked();
    await expect(first.getByRole('button', { name: 'Custom', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(first.getByRole('spinbutton', { name: 'Delete posts & replies, Per day' })).toHaveValue('100');

    // Another, where the person set active hours of their own first: what they set there stays.
    const second = (await newXomoni()).dashboard;
    await openXWindow(second);
    await openPage(second, 'Settings');
    await second.getByRole('combobox', { name: 'From' }).selectOption('9');
    await expect(second.getByRole('combobox', { name: 'From' })).toHaveValue('9');
    await pick(moveCard(second).getByRole('button', { name: 'Import from a file' }), exported.path);
    await importDialog(second).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(second)).toBeVisible();
    await expect(second.getByRole('switch', { name: 'Only work during active hours' })).toBeChecked();
    await expect(second.getByRole('combobox', { name: 'From' })).toHaveValue('9');
    await expect(second.getByRole('button', { name: 'Careful (⅕ of X)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test.describe('a file Xomoni didn’t write, or not as it is', () => {
    test('S300-05 a JSON file that isn’t an export is refused, and nothing is imported', async ({ dashboard }) => {
      await pick(offer(dashboard).getByRole('button', { name: 'Import your data' }), upload({ posts: ['hello'] }));
      await expect(refusal(dashboard)).toContainText(
        'This isn’t a file from Xomoni’s Export everything. Nothing was imported.',
      );
      await expect(importDialog(dashboard)).toBeHidden();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
      await expect(offer(dashboard)).toContainText('Coming from another Xomoni?');
    });

    test('S300-06 a file changed after it was exported fails its checksum, and nothing is imported', async ({
      dashboard,
      page,
      newXomoni,
    }) => {
      const { file } = await exportedCopy(dashboard, page);
      const changed = {
        ...file,
        data: { ...file.data, items: rows(file, 'items').map((item) => ({ ...item, text: 'Words put in by hand.' })) },
      };
      const { dashboard: fresh } = await newXomoni();
      await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), upload(changed));
      await expect(refusal(fresh)).toContainText(
        'This file was changed or damaged after it was exported: its checksum doesn’t match. Export again from the Xomoni you’re leaving. Nothing was imported.',
      );
      await expect(importDialog(fresh)).toBeHidden();
      await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    });

    test('S300-07 a file from a newer Xomoni asks for an update first, and nothing is imported', async ({
      dashboard,
      page,
    }) => {
      const { file } = await exportedCopy(dashboard, page);
      const { checksum: _, ...rest } = file;
      await pick(
        moveCard(dashboard).getByRole('button', { name: 'Import from a file' }),
        upload(sealed({ ...rest, version: 3 })),
      );
      await expect(refusal(dashboard)).toContainText(
        'This file was made by a newer Xomoni. Update this Xomoni first, then import it. Nothing was imported.',
      );
      await expect(importDialog(dashboard)).toBeHidden();
    });

    test('S300-08 an older Xomoni’s export asks for a new export, and nothing is imported', async ({
      dashboard,
      page,
    }) => {
      const { file } = await exportedCopy(dashboard, page);
      // Xomoni 0.4's *Export everything*: no format, four tables, the accounts and the items at the top.
      const old = {
        exportedAt: file.exportedAt,
        accounts: file.data.accounts,
        items: file.data.items,
        jobs: [],
        logs: [],
      };
      await pick(moveCard(dashboard).getByRole('button', { name: 'Import from a file' }), upload(old));
      await expect(refusal(dashboard)).toContainText(
        'This file comes from an older Xomoni’s Export everything, which doesn’t hold all a move needs. Update the Xomoni you’re leaving, export again, and import the new file.',
      );
      await expect(importDialog(dashboard)).toBeHidden();
    });

    test('S300-09 a whole file with a record out of shape is refused all at once, and nothing is imported', async ({
      dashboard,
      page,
      newXomoni,
    }) => {
      const { file } = await exportedCopy(dashboard, page);
      const { checksum: _, ...rest } = file;
      // The first post kept as it is, the second with an id X never gives: the whole file is refused.
      const [good, other] = rows(file, 'items');
      const handmade = sealed({ ...rest, data: { ...file.data, items: [good!, { ...other!, id: 'not-an-x-id' }] } });
      const { dashboard: fresh } = await newXomoni();
      await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), upload(handmade));
      await expect(refusal(fresh)).toContainText(
        'A record in this file isn’t in the shape Xomoni writes. It was changed after it was exported, or made by another tool. Nothing was imported.',
      );
      await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    });

    test('S300-10 a file with data Xomoni doesn’t know is refused, and nothing is imported', async ({
      dashboard,
      page,
    }) => {
      const { file } = await exportedCopy(dashboard, page);
      const { checksum: _, ...rest } = file;
      const handmade = sealed({ ...rest, data: { ...file.data, passwords: [{ site: 'x.com' }] } });
      await pick(moveCard(dashboard).getByRole('button', { name: 'Import from a file' }), upload(handmade));
      await expect(refusal(dashboard)).toContainText(
        'This file holds data Xomoni doesn’t know. It was changed after it was exported, or made by another tool. Nothing was imported.',
      );
    });
  });

  test('S300-11 a file whose copy stopped halfway is refused, and nothing is imported', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const { text } = await exportedCopy(dashboard, page);
    const { dashboard: fresh } = await newXomoni();
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), upload(text.slice(0, text.length / 2)));
    await expect(refusal(fresh)).toContainText(
      'This isn’t a file from Xomoni’s Export everything. Nothing was imported.',
    );
    await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
  });

  test('S300-12 with X out of reach, the export and the import still work: they never ask X', async ({
    dashboard,
    page,
    context,
    newXomoni,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    // From now on, X doesn't answer at all, in either browser.
    await context.route(/^https:\/\/x\.com\//, (route) => route.abort('internetdisconnected'));
    const exported = await exportEverything(dashboard);
    expect(rows(exported.file, 'items')).toHaveLength(2);

    const other = await newXomoni();
    await other.context.route(/^https:\/\/x\.com\//, (route) => route.abort('internetdisconnected'));
    await pick(offer(other.dashboard).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(other.dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(other.dashboard)).toBeVisible();
    await openLibrary(other.dashboard);
    await expect(libraryRows(other.dashboard)).toHaveCount(2);
  });

  test('S300-13 an import while a job runs in another dashboard tab is refused, and nothing is imported', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { path: file } = await exportedCopy(dashboard, page);
    await waitingCleanup(dashboard, page, { browsed: true });

    // A second dashboard tab, where no job runs: its import asks, and the job in the first tab refuses it.
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await pick(moveCard(second).getByRole('button', { name: 'Import from a file' }), file);
    await importDialog(second).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(refusal(second)).toContainText('A job is running. Pause it, then import. Nothing was imported.');
    await expect(imported(second)).toHaveCount(0);
  });

  test('S300-14 while a job runs here, Import waits until it is paused', async ({ dashboard, page }) => {
    const card = await waitingCleanup(dashboard, page);
    await openPage(dashboard, 'Settings');
    await expect(moveCard(dashboard).getByRole('button', { name: 'Import from a file' })).toBeDisabled();
    await expect(moveCard(dashboard)).toContainText('Import waits until no job runs: pause it first.');

    await openPage(dashboard, 'Activity');
    await card.getByRole('button', { name: 'Pause' }).click();
    await openPage(dashboard, 'Settings');
    await expect(moveCard(dashboard).getByRole('button', { name: 'Import from a file' })).toBeEnabled();
    await expect(moveCard(dashboard)).not.toContainText('Import waits until no job runs');
  });

  test('S300-15 nothing leaves the computer: export and import send no request at all', async ({
    dashboard,
    page,
    context,
    newXomoni,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await page.close();
    const sentByOld = requestsOf(context);
    const exported = await exportEverything(dashboard);
    await expect(toasts(dashboard)).toContainText(`Saved ${exported.name}.`);

    const other = await newXomoni();
    const sentByNew = requestsOf(other.context);
    await pick(offer(other.dashboard).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(other.dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(other.dashboard)).toBeVisible();
    await openLibrary(other.dashboard);
    await expect(libraryRows(other.dashboard)).toHaveCount(2);

    // Nothing to the network: not x.com, xomoni.com or anywhere else. The browser's own pages, such as Edge's icon for
    // a download (edge://fileicon), and the dashboard's own files aren't the network.
    const network = (sent: string[]) => sent.filter((r) => /^\S+ (https?|wss?):/.test(r));
    expect(network(sentByOld), 'requests while exporting').toEqual([]);
    expect(network(sentByNew), 'requests while importing').toEqual([]);
  });

  test('S300-16 a job that hadn’t finished arrives ended, and nothing starts on X', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    await waitingCleanup(dashboard, page);
    const exported = await exportEverything(dashboard);

    const other = await newXomoni();
    const sent = requestsOf(other.context);
    await pick(offer(other.dashboard).getByRole('button', { name: 'Import your data' }), exported.path);
    await expect(importDialog(other.dashboard).getByRole('list', { name: 'Accounts in the file' })).toContainText(
      '· 1 jobs ·',
    );
    await expect(importDialog(other.dashboard)).toContainText(
      'Jobs that hadn’t finished arrive ended, and nothing starts on X.',
    );
    await importDialog(other.dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(other.dashboard)).toBeVisible();

    await openPage(other.dashboard, 'Activity');
    // It is no longer open: All shows it, ended.
    await expect(other.dashboard.getByRole('main')).toContainText('No open jobs');
    await other.dashboard.getByRole('main').getByRole('button', { name: 'All', exact: true }).click();
    const card = jobCard(other.dashboard, BEFORE_2022);
    await expect(card).toContainText(
      'Moved from another Xomoni before it finished. Start a new one here to go on: it skips what is already done.',
    );
    await expect(card.getByRole('button', { name: 'Resume' })).toHaveCount(0);
    // No X window opened, and nothing was asked of X.
    expect(other.context.pages().filter((p) => p.url().startsWith('https://x.com/'))).toEqual([]);
    expect(sent.filter((r) => new URL(r.slice(r.indexOf(' ') + 1)).host === 'x.com')).toEqual([]);
  });

  test('S300-17 the new Xomoni asks for the person’s informed consent again before its first job', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    // The person read and accepted the risks in the Xomoni they leave.
    await waitingCleanup(dashboard, page);
    const exported = await exportEverything(dashboard);
    expect(Object.keys(exported.file.data)).not.toContain('consents');

    const other = await newXomoni();
    await pick(offer(other.dashboard).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(other.dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(other.dashboard)).toBeVisible();
    await openCleanup(other.dashboard);
    await removeBefore(other.dashboard, '2022-01-01');
    await expect.poll(() => matching(other.dashboard)).toBe(2);
    await continueWithoutArchive(other.dashboard);
    await confirmCleanup(other.dashboard);
    await expect(risksDialog(other.dashboard)).toBeVisible();
    // Until the person accepts, nothing starts: no X window opens.
    expect(other.context.pages().filter((p) => p.url().startsWith('https://x.com/'))).toEqual([]);
  });

  test('S300-28 an account X warned arrives warned, and a typed Resume anyway stays behind', async ({
    dashboard,
    page,
    context,
    newXomoni,
  }) => {
    // X's Home shows its notice of a limited account: the job stops, and Resume is locked for 12 hours.
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2022-01-01');
    await expect.poll(() => matching(dashboard)).toBe(2);
    await continueWithoutArchive(dashboard);
    await servePage(context, '/home', 'home-limited.html');
    await startCleanup(dashboard);
    const card = jobCard(dashboard, BEFORE_2022);
    await expect(card.getByRole('button', { name: /^Resume in 1[12]h \d+m$/ })).toBeDisabled();
    // The person resumes anyway, typing RESUME: their own decision, in this Xomoni.
    await card.getByRole('button', { name: 'Resume anyway…' }).click();
    const dialog = dashboard.getByRole('dialog', { name: 'Risk level 3: Defensive' });
    await dialog.getByRole('textbox', { name: 'Type RESUME to continue at your own risk' }).fill('RESUME');
    await dialog.getByRole('button', { name: 'Resume anyway' }).click();
    await expect(dialog).toBeHidden();
    const exported = await exportEverything(dashboard);
    expect(rows(exported.file, 'risk').map((event) => event.kind)).toContain('override');

    const other = await newXomoni();
    await pick(offer(other.dashboard).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(other.dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(other.dashboard)).toBeVisible();
    // X's warning came along; the decision to resume despite it did not.
    const status = other.dashboard.getByRole('region', { name: 'Status' });
    await expect(status.getByRole('heading', { level: 2, name: 'Resting after a warning from X' })).toBeVisible();
    await expect(status).toContainText(/Xomoni can carry on in 1[12]h \d+m, at a slower pace\./);
  });

  test('S300-18 a file asking for a pace faster than Careful is brought within one fifth of X’s limits', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const { file } = await exportedCopy(dashboard, page);
    const { checksum: _, ...rest } = file;
    const fast = {
      minDelay: 1,
      maxDelay: 2,
      batchSize: 500,
      batchPauseMin: 1,
      batchPauseMax: 2,
      hourlyCap: 5000,
      dailyCap: 100000,
    };
    const settings = {
      key: 'settings',
      value: { preset: 'custom', pacing: { delete: fast }, activeHours: { enabled: false, start: 8, end: 23 } },
    };
    const handmade = sealed({ ...rest, data: { ...file.data, kv: [...rows(file, 'kv'), settings] } });

    const { dashboard: fresh } = await newXomoni();
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), upload(handmade));
    await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(fresh)).toBeVisible();
    await openPage(fresh, 'Settings');
    // Custom, as the file says, but no faster than Careful in any way: 80 s at least, 960 a day at most.
    await expect(fresh.getByRole('button', { name: 'Custom', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(fresh.getByRole('spinbutton', { name: 'Delete posts & replies, Min delay (seconds)' })).toHaveValue(
      '80',
    );
    await expect(fresh.getByRole('spinbutton', { name: 'Delete posts & replies, Per day' })).toHaveValue('960');
    await expect(fresh.getByRole('switch', { name: 'Only work during active hours' })).not.toBeChecked();
  });

  test('S300-19 a file carrying a xomoni.com connection is refused: no file can connect this Xomoni', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const { file } = await exportedCopy(dashboard, page);
    const { checksum: _, ...rest } = file;
    const cloud = { key: 'cloud', value: { deviceToken: 'made-up-token-of-another-account', userId: 'someone-else' } };
    const handmade = sealed({ ...rest, data: { ...file.data, kv: [...rows(file, 'kv'), cloud] } });

    const { dashboard: fresh } = await newXomoni();
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), upload(handmade));
    await expect(refusal(fresh)).toContainText(
      'This file holds data Xomoni doesn’t know. It was changed after it was exported, or made by another tool. Nothing was imported.',
    );
    await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
  });

  test('S300-20 on a first run, the offer shows until Not now, and stays away after a reload', async ({
    dashboard,
  }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(
      offer(dashboard).getByRole('heading', { level: 2, name: 'Coming from another Xomoni?' }),
    ).toBeVisible();
    await expect(offer(dashboard).getByRole('button', { name: 'Import your data' })).toBeEnabled();

    await offer(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(offer(dashboard)).toHaveCount(0);
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(offer(dashboard)).toHaveCount(0);
    // Settings keeps the import for later.
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    await expect(moveCard(dashboard).getByRole('button', { name: 'Import from a file' })).toBeEnabled();
  });

  test('S300-21 a file with no data in it is refused, and nothing is imported', async ({ dashboard, page }) => {
    const { file } = await exportedCopy(dashboard, page);
    const { checksum: _, ...rest } = file;
    const empty = sealed({ ...rest, data: Object.fromEntries(TABLES.map((table) => [table, []])) });
    await pick(moveCard(dashboard).getByRole('button', { name: 'Import from a file' }), upload(empty));
    await expect(refusal(dashboard)).toContainText('This file holds no Xomoni data. Nothing was imported.');
  });

  test('S300-22 Cancel in Import this data? imports nothing, and the file can be picked again', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const exported = await exportedCopy(dashboard, page);
    const { dashboard: fresh } = await newXomoni();
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(fresh).getByRole('button', { name: 'Cancel' }).click();
    await expect(importDialog(fresh)).toBeHidden();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(offer(fresh)).toContainText('Coming from another Xomoni?');

    // Escape closes it the same way.
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), exported.path);
    await expect(importDialog(fresh)).toBeVisible();
    await fresh.keyboard.press('Escape');
    await expect(importDialog(fresh)).toBeHidden();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(imported(fresh)).toHaveCount(0);
  });

  test('S300-23 Dismiss puts the import’s result away for good, and the offer doesn’t come back', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const exported = await exportedCopy(dashboard, page);
    const { dashboard: fresh } = await newXomoni();
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(fresh)).toBeVisible();

    await offer(fresh).getByRole('button', { name: 'Dismiss' }).click();
    await expect(imported(fresh)).toHaveCount(0);
    await expect(offer(fresh)).toHaveCount(0);
    await fresh.reload();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(offer(fresh)).toHaveCount(0);
    await openPage(fresh, 'Settings');
    await expect(imported(fresh)).toHaveCount(0);
  });

  test('S300-24 the whole move works with the keyboard alone', async ({ dashboard, page, newXomoni }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openPage(dashboard, 'Settings');
    const saved = dashboard.waitForEvent('download');
    await tabTo(moveCard(dashboard).getByRole('button', { name: 'Export everything' }));
    await dashboard.keyboard.press('Enter');
    const download = await saved;

    const { dashboard: fresh } = await newXomoni();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    const chooser = fresh.waitForEvent('filechooser');
    await tabTo(offer(fresh).getByRole('button', { name: 'Import your data' }));
    await fresh.keyboard.press('Enter');
    await (await chooser).setFiles(await download.path());
    // The dialog opens on its Import button, so Enter imports.
    await expect(importDialog(fresh).getByRole('button', { name: 'Import', exact: true })).toBeFocused();
    await fresh.keyboard.press('Enter');
    await expect(imported(fresh)).toBeVisible();
    await tabTo(offer(fresh).getByRole('button', { name: 'Dismiss' }));
    await fresh.keyboard.press('Space');
    await expect(imported(fresh)).toHaveCount(0);
  });

  test('S300-25 the card, the dialog, a refusal and the result have no serious accessibility violation', async ({
    dashboard,
    page,
  }) => {
    const exported = await exportedCopy(dashboard, page);
    await expectNoSeriousA11yViolations(dashboard);

    await pick(moveCard(dashboard).getByRole('button', { name: 'Import from a file' }), upload('not json'));
    await expect(refusal(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);

    await pick(moveCard(dashboard).getByRole('button', { name: 'Import from a file' }), exported.path);
    await expect(importDialog(dashboard)).toBeVisible();
    // The refusal is gone once a good file is picked.
    await expect(refusal(dashboard)).toHaveCount(0);
    await expectNoSeriousA11yViolations(dashboard);

    await importDialog(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(dashboard)).toContainText('Everything in the file was already here.');
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S300-26 the offer, the dialog and the result read well, with no serious violation', async ({
      dashboard,
      page,
      newXomoni,
    }) => {
      const exported = await exportedCopy(dashboard, page);
      const { dashboard: fresh } = await newXomoni();
      expect(await fresh.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await expect(offer(fresh)).toContainText('Coming from another Xomoni?');
      await expectNoSeriousA11yViolations(fresh);

      await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), exported.path);
      await expect(importDialog(fresh)).toBeVisible();
      await expectNoSeriousA11yViolations(fresh);
      await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
      await expect(imported(fresh)).toBeVisible();
      await expectNoSeriousA11yViolations(fresh);
    });
  });

  test('S300-27 after a reload and in a second tab, the data and the import’s result are still there', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const exported = await exportedCopy(dashboard, page);
    const other = await newXomoni();
    const fresh = other.dashboard;
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), exported.path);
    await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(fresh)).toBeVisible();

    await fresh.reload();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(imported(fresh)).toBeVisible();
    await expect(fresh.getByRole('region', { name: 'Counts' })).toContainText(/Posts\s*2/);

    const second = await other.context.newPage();
    await second.goto(`chrome-extension://${other.extensionId}/dashboard.html#/settings`);
    await expect(imported(second)).toBeVisible();
    await openLibrary(second);
    await expect(libraryRows(second)).toHaveCount(2);
    // The activity log keeps a line for what moved in.
    await openPage(second, 'Activity');
    await second.getByRole('tab', { name: 'Log' }).click();
    await expect(second.getByRole('main')).toContainText(`Moved in from Xomoni ${VERSION} (exported`);
  });

  test('S300-29 the vault moves: its ledger, analytics and timeline arrive whole, and stay after a reload', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const { file } = await exportedCopy(dashboard, page);
    const id = FIXTURE_ACCOUNT.id;
    const at = Date.now() - 3_600_000;
    // Synthetic rows, shaped as the vault writes them (ADR-0043); the post id is one X never issued.
    const vault = {
      vaultImports: [
        {
          id: `${id}:x-archive:${at}:abc123`,
          accountId: id,
          source: 'x-archive',
          fileName: 'twitter-2026-11-08-abc.zip',
          bytes: 2048,
          fingerprint: 'zip:00112233445566778899aabbccddeeff',
          importedAt: at,
          coverFrom: null,
          coverTo: at - 86_400_000,
          counts: { read: 2, merged: 2, skipped: 0, parts: { tweets: 2 } },
          parser: 'x-archive@1',
          problems: [],
        },
      ],
      analyticsPosts: [
        {
          key: `${id}:9000000000000000001`,
          accountId: id,
          postId: '9000000000000000001',
          createdAt: at - 86_400_000,
          asOf: at,
          impressions: 1200,
          likes: 9,
        },
      ],
      analyticsDays: [{ accountId: id, day: '2026-11-01', asOf: at, impressions: 3000, newFollows: 2 }],
      accountEvents: [
        { accountId: id, kind: 'note', at, source: 'person', words: '<img src=x onerror=alert(1)> appealed' },
      ],
    };
    const { checksum: _, ...rest } = file;
    const withVault = sealed({ ...rest, data: { ...rest.data, ...vault } });

    const other = await newXomoni();
    const fresh = other.dashboard;
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), upload(withVault));
    await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(fresh)).toBeVisible();
    await fresh.reload();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    // The markup stays text: nothing on the page ran it.
    await expect(fresh.locator('img[src="x"]')).toHaveCount(0);

    const again = await exportEverything(fresh);
    for (const table of VAULT_TABLES) {
      expect(rows(again.file, table), table).toEqual(vault[table as keyof typeof vault]);
    }
  });

  test('S300-30 a file from a Xomoni before the vault, version 1, still imports', async ({
    dashboard,
    page,
    newXomoni,
  }) => {
    const { file } = await exportedCopy(dashboard, page);
    const { checksum: _, ...rest } = file;
    const core = Object.fromEntries(CORE_TABLES.map((table) => [table, rest.data[table]]));
    const versionOne = sealed({ ...rest, version: 1, data: core });

    const { dashboard: fresh } = await newXomoni();
    await pick(offer(fresh).getByRole('button', { name: 'Import your data' }), upload(versionOne));
    await expect(importDialog(fresh)).toContainText(
      `@${FIXTURE_ACCOUNT.handle}: 2 posts, replies and reposts · 0 likes`,
    );
    await importDialog(fresh).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(imported(fresh)).toBeVisible();
    await openLibrary(fresh);
    await expect(libraryRows(fresh)).toHaveCount(2);

    const again = await exportEverything(fresh);
    expect(again.file.version).toBe(2);
    for (const table of VAULT_TABLES) expect(rows(again.file, table), table).toEqual([]);
  });
});
