import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { EXTENSION_DIR_ENV } from '../support/build-extension';
import { browseProfile, openPage } from '../support/cleanup';
import { test as base, expect, openXWindow } from '../support/extension';
import { PREVIOUS_DIR_ENV, type ReleaseBuild, releaseBuild } from '../support/release-builds';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';

// The release smoke test (#419, docs/RELEASING.md): the candidate's zip and the previous release's, as people install
// them, in a real browser with x.com served from the fixtures and no network (ADR-0040). A clean install, an update in
// place, a rollback and a move. Each test installs from a folder of its own, as a person installs the zip into one,
// and an update replaces that folder's files and loads it again, as pressing *Reload* in chrome://extensions does.
// It drives the previous release's dashboard too, so it reads only what both versions show; when a release renames
// what it presses, change it here. The harness fails a test whose browser sent a request to any host but x.com.

/** The release being made, its zip unpacked. */
const CANDIDATE: ReleaseBuild = releaseBuild(EXTENSION_DIR_ENV);
/** The release people have now, its zip unpacked. */
const PREVIOUS: ReleaseBuild = releaseBuild(PREVIOUS_DIR_ENV);

/** Active hours other than Xomoni's 8:00 to 23:00, as a setting the person changed. */
const HOURS = { start: 9, end: 21 };

/** What Xomoni keeps in IndexedDB that these tests look at, read without Xomoni's code. */
interface Stored {
  /** IndexedDB's version of the `xomoni` database (Dexie's version × 10). */
  version: number;
  /** The X accounts' ids. */
  accounts: string[];
  /** How many posts, replies, reposts and likes. */
  items: number;
  /** Active hours as stored in Settings, or null. */
  activeHours: unknown;
}

const test = base.extend<{ startWith: ReleaseBuild }>({
  /** The release the test's own browser installs first. */
  startWith: [CANDIDATE, { option: true }],
  // A folder of the test's own with that release's files, which an update replaces: Chrome names an unpacked Xomoni
  // without a `key` by its folder.
  extensionBuild: async ({ startWith }, provide) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'xomoni-release-'));
    cpSync(startWith.dir, dir, { recursive: true });
    await provide(dir);
    rmSync(dir, { recursive: true, force: true });
  },
});

/** Replaces the files in `dir` with `build`'s, keeping the folder, as a person unzips a new release over the old one. */
function replaceFiles(dir: string, build: ReleaseBuild) {
  for (const name of readdirSync(dir)) rmSync(path.join(dir, name), { recursive: true, force: true });
  cpSync(build.dir, dir, { recursive: true });
}

/** The service worker of the Xomoni `extensionId` is, once it runs: its background. */
const isWorkerOf = (extensionId: string) => (worker: Worker) =>
  worker.url() === `chrome-extension://${extensionId}/sw.js`;

/**
 * Loads the folder `dir` in `context`'s browser again, as *Reload* does for the Xomoni `extensionId` installed from it.
 * Checks that the browser gives it the same id, then returns its new service worker, which Chrome starts at once.
 */
async function loadAgain(context: BrowserContext, dir: string, extensionId: string): Promise<Worker> {
  const started = context.waitForEvent('serviceworker', { predicate: isWorkerOf(extensionId) });
  const devtools = await context.browser()!.newBrowserCDPSession();
  try {
    const { id } = await devtools.send('Extensions.loadUnpacked', { path: dir });
    expect(id, 'the same id, so the same data').toBe(extensionId);
  } finally {
    await devtools.detach();
  }
  return started;
}

/**
 * Checks that `errors` is empty once it holds every error `worker` showed so far. The harness hears a worker's uncaught
 * exceptions through DevTools, a moment after they happen, and in order: so this throws one in the worker on purpose,
 * waits for it, and takes it out before looking.
 */
async function expectNoErrors(errors: string[], worker: Worker, browser = 'the browser') {
  const marker = `release smoke test: every error heard ${String(Date.now())}`;
  await worker.evaluate((text) => {
    setTimeout(() => {
      throw new Error(text);
    });
  }, marker);
  await expect.poll(() => errors.some((e) => e.includes(marker)), { message: 'the marker heard' }).toBe(true);
  errors.splice(
    errors.findIndex((e) => e.includes(marker)),
    1,
  );
  expect(errors, `errors in ${browser}`).toEqual([]);
}

/** Opens Xomoni's dashboard in a new tab, as the toolbar button does once Xomoni was reloaded. */
async function openDashboard(context: BrowserContext, extensionId: string): Promise<Page> {
  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(dashboard.getByRole('navigation')).toBeVisible();
  return dashboard;
}

/** The part of the extension API these tests call in Xomoni's pages and service worker. */
interface ExtensionGlobal {
  chrome: { runtime: { getManifest(): { version: string } } };
}

/** The version of the Xomoni in this page or service worker, as its manifest says: run in it with `evaluate`. */
const manifestVersion = () => (globalThis as unknown as ExtensionGlobal).chrome.runtime.getManifest().version;

/** The version of the Xomoni whose page `page` is. */
const versionIn = (page: Page): Promise<string> => page.evaluate(manifestVersion);

/** What the `xomoni` database holds, read with IndexedDB itself from one of Xomoni's pages, once Xomoni made it. */
function storedIn(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((known) => known.name === 'xomoni'))
      throw new Error('Xomoni has no database yet');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('xomoni');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error('IndexedDB refused to open xomoni'));
    });
    const read = <T>(store: string, op: (s: IDBObjectStore) => IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        const request = op(db.transaction(store, 'readonly').objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB refused to read ${store}`));
      });
    try {
      const settings = (await read<unknown>('kv', (s) => s.get('settings'))) as
        { value?: { activeHours?: unknown } } | undefined;
      return {
        version: db.version,
        accounts: (await read('accounts', (s) => s.getAllKeys())).map(String),
        items: await read('items', (s) => s.count()),
        activeHours: settings?.value?.activeHours ?? null,
      };
    } finally {
      db.close();
    }
  });
}

/** The active hours Settings shows, From and Until, as hours. */
async function hoursShown(dashboard: Page): Promise<{ start: number; end: number }> {
  await openPage(dashboard, 'Settings');
  const from = dashboard.getByRole('combobox', { name: 'From' });
  await expect(from).toBeVisible();
  return {
    start: Number(await from.inputValue()),
    end: Number(await dashboard.getByRole('combobox', { name: 'Until' }).inputValue()),
  };
}

/**
 * Sets active hours to `HOURS` in Settings, as the person does, and waits until Xomoni has them. Each change waits for
 * the page to show it stored, as a person sees it before the next: Settings saves each change over the settings it
 * shows, so a second change made before the first shows would undo it.
 */
async function changeHours(dashboard: Page) {
  await openPage(dashboard, 'Settings');
  for (const [name, hour] of [
    ['From', HOURS.start],
    ['Until', HOURS.end],
  ] as const) {
    const box = dashboard.getByRole('combobox', { name });
    await box.selectOption(String(hour));
    await expect(box).toHaveValue(String(hour));
  }
  await expect.poll(async () => (await storedIn(dashboard)).activeHours).toEqual(expect.objectContaining(HOURS));
}

/**
 * The person's start in the release they have: the X window open, their profile's posts browsed, so Xomoni keeps the
 * account and its two posts; then active hours changed. Returns what Xomoni then holds.
 */
async function startUsing(dashboard: Page, page: Page): Promise<Stored> {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await expect
    .poll(async () => {
      const stored = await storedIn(dashboard);
      return { accounts: stored.accounts, items: stored.items };
    })
    .toEqual({ accounts: [FIXTURE_ACCOUNT.id], items: 2 });
  await changeHours(dashboard);
  return storedIn(dashboard);
}

/** Checks that Xomoni's pages show the account, its posts and the changed hours, and that the database holds them. */
async function expectDataKept(dashboard: Page, before: Stored) {
  const stored = await storedIn(dashboard);
  expect(stored.accounts, 'the X account').toEqual([FIXTURE_ACCOUNT.id]);
  expect(stored.items, 'its posts').toBe(before.items);
  expect(stored.activeHours, 'the changed setting').toEqual(before.activeHours);
  await expect(
    dashboard
      .getByRole('complementary')
      .getByRole('button', { name: `${FIXTURE_ACCOUNT.name} @${FIXTURE_ACCOUNT.handle}` }),
  ).toBeVisible();
  expect(await hoursShown(dashboard)).toEqual(HOURS);
}

/** What `updateInPlace` needs from the test. */
interface UpdateArgs {
  context: BrowserContext;
  extensionBuild: string;
  extensionId: string;
  dashboard: Page;
  page: Page;
}

/**
 * The update in place: the previous release used as `startUsing` does, then the candidate's files over it and the folder
 * loaded again, with the same id. Returns what Xomoni held before and after, and the candidate's dashboard and service
 * worker.
 */
async function updateInPlace({
  context,
  extensionBuild,
  extensionId,
  dashboard,
  page,
}: UpdateArgs): Promise<{ before: Stored; after: Stored; dashboard: Page; worker: Worker }> {
  expect(await versionIn(dashboard)).toBe(PREVIOUS.version);
  const before = await startUsing(dashboard, page);

  replaceFiles(extensionBuild, CANDIDATE);
  const worker = await loadAgain(context, extensionBuild, extensionId);
  expect(await worker.evaluate(manifestVersion)).toBe(CANDIDATE.version);
  const updated = await openDashboard(context, extensionId);
  expect(await versionIn(updated)).toBe(CANDIDATE.version);
  return { before, after: await storedIn(updated), dashboard: updated, worker };
}

/**
 * What the maintainer needs to know when the candidate raised the database's version, or null when it kept it.
 * IndexedDB never takes a version back down, so the previous release then has to open a database newer than it knows.
 */
const raisedDatabase = (before: Stored, after: Stored): string | null =>
  after.version > before.version
    ? `Xomoni ${CANDIDATE.version} raises IndexedDB xomoni from version ${String(before.version)} to ` +
      `${String(after.version)}, and no rollback takes it back down: Xomoni ${PREVIOUS.version} has to open it as it ` +
      'is. If the rollback test fails, going back needs a fresh profile: Export everything first, then Import into ' +
      'the older Xomoni.'
    : null;

/** Says `text` in the run's output and in the report, under `type`: what the maintainer writes in the release issue. */
function note(type: string, text: string) {
  test.info().annotations.push({ type, description: text });
  console.warn(`${type}: ${text}`);
}

test.describe(`release smoke test: Xomoni ${PREVIOUS.version} to ${CANDIDATE.version}`, () => {
  test('a clean install of the candidate opens its dashboard, with no error', async ({
    dashboard,
    serviceWorker,
    browserErrors,
  }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    expect(await versionIn(dashboard)).toBe(CANDIDATE.version);
    expect(await serviceWorker.evaluate(manifestVersion)).toBe(CANDIDATE.version);
    // The person's first steps: the X window, where Xomoni meets the account, then Home and Settings.
    await openXWindow(dashboard);
    for (const item of ['Home', 'Settings'] as const) {
      await openPage(dashboard, item);
      await expect(dashboard.getByRole('heading', { level: 1, name: item })).toBeVisible();
    }
    await expectNoErrors(browserErrors, serviceWorker);
  });

  test.describe('from the previous release', () => {
    test.use({ startWith: PREVIOUS });

    test('an update in place keeps the id, the database, the account and the settings', async ({
      context,
      extensionBuild,
      extensionId,
      dashboard,
      page,
      browserErrors,
    }) => {
      const args = { context, extensionBuild, extensionId, dashboard, page };
      const { before, after, dashboard: updated, worker } = await updateInPlace(args);
      const raised = raisedDatabase(before, after);
      if (raised) note('database', raised);
      expect(after.version, 'IndexedDB xomoni keeps its version, or a newer one').toBeGreaterThanOrEqual(
        before.version,
      );
      await expectDataKept(updated, before);
      await expectNoErrors(browserErrors, worker);
    });

    test('a rollback to the previous release opens the same database and keeps the data', async ({
      context,
      extensionBuild,
      extensionId,
      dashboard,
      page,
      browserErrors,
    }) => {
      const args = { context, extensionBuild, extensionId, dashboard, page };
      const { before, after, worker: updated } = await updateInPlace(args);
      await expectNoErrors(browserErrors, updated);
      const raised = raisedDatabase(before, after);
      if (raised) note('rollback', raised);

      replaceFiles(extensionBuild, PREVIOUS);
      const worker = await loadAgain(context, extensionBuild, extensionId);
      expect(await worker.evaluate(manifestVersion)).toBe(PREVIOUS.version);
      const rolledBack = await openDashboard(context, extensionId);
      expect(await versionIn(rolledBack)).toBe(PREVIOUS.version);
      expect((await storedIn(rolledBack)).version, 'IndexedDB xomoni at the version the update left').toBe(
        after.version,
      );
      await expectDataKept(rolledBack, before);
      await expectNoErrors(browserErrors, worker);
    });

    test('Export everything in the previous release, Import into a fresh candidate', async ({
      dashboard,
      serviceWorker,
      page,
      newXomoni,
      browserErrors,
    }) => {
      await startUsing(dashboard, page);
      await openPage(dashboard, 'Settings');
      const saved = dashboard.waitForEvent('download');
      await dashboard.getByRole('button', { name: 'Export everything' }).click();
      const file = await (await saved).path();
      await expectNoErrors(browserErrors, serviceWorker, `Xomoni ${PREVIOUS.version}`);

      const fresh = await newXomoni(CANDIDATE.dir);
      expect(await versionIn(fresh.dashboard)).toBe(CANDIDATE.version);
      const offer = fresh.dashboard.getByRole('region', { name: 'Move your data' });
      const chooser = fresh.dashboard.waitForEvent('filechooser');
      await offer.getByRole('button', { name: 'Import your data' }).click();
      await (await chooser).setFiles(file);
      const dialog = fresh.dashboard.getByRole('dialog', { name: 'Import this data?' });
      await expect(dialog).toContainText(`From Xomoni ${PREVIOUS.version}, exported`);
      await dialog.getByRole('button', { name: 'Import', exact: true }).click();

      await expect(fresh.dashboard.getByRole('status').filter({ hasText: 'Your data is here' })).toContainText(
        `Imported from Xomoni ${PREVIOUS.version}.`,
      );
      await expect(fresh.dashboard.getByRole('main')).toContainText(`@${FIXTURE_ACCOUNT.handle}`);
      const moved = await storedIn(fresh.dashboard);
      expect(moved.accounts).toEqual([FIXTURE_ACCOUNT.id]);
      expect(moved.items).toBe(2);
      expect(moved.activeHours).toEqual(expect.objectContaining(HOURS));
      const worker =
        fresh.context.serviceWorkers().find(isWorkerOf(fresh.extensionId)) ??
        (await fresh.context.waitForEvent('serviceworker', { predicate: isWorkerOf(fresh.extensionId) }));
      await expectNoErrors(fresh.errors, worker, `Xomoni ${CANDIDATE.version}`);
    });
  });
});
