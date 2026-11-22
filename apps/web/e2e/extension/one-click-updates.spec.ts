import { rmSync } from 'node:fs';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
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
} from '../support/cleanup';
import { test as base, expect, openXWindow, tabTo } from '../support/extension';
import {
  type GitHubAnswer,
  type ReleaseFile,
  type ThrowawayKey,
  buildFiles,
  buildTrusting,
  manifestOf,
  nextVersion,
  releaseOf,
  releaseUrls,
  serveRelease,
  sha256,
  throwawayKey,
  zipOf,
} from '../support/release';
import { type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// Update in one click (docs/scenarios/305-one-click-updates.md, ADR-0033, #305, #345): a zip install downloads the new
// version from GitHub, checks its signature and every file, and writes it into its own folder. The build people have
// today trusts no signing key, so its updater is dormant (S305-01); the other tests run Xomoni as it will be once the
// maintainer adds the key, built for this run trusting a throwaway key instead (`buildTrusting`), with releases signed
// by it and served at GitHub's URLs (`serveRelease`). xomoni.com, which tells Xomoni a newer version is out, is played
// at the extension (`serveXomoniSite`). Playwright can't answer Chrome's own prompts: it aborts the folder picker, and
// the permission prompt waits for a person. So the person's answers are played at the page: the folder picker gives a
// folder in the browser's private file system holding this Xomoni's files, and the prompt for GitHub's access says yes
// or no. Chrome doesn't load Xomoni from that folder, so it restarts as the version it was (S305-04); the restart into
// the new version is the one manual scenario (S305-05).

/** Xomoni built for this worker, trusting a throwaway key, with its files and the key that signs its releases. */
interface Trusted {
  dir: string;
  files: ReleaseFile[];
  key: ThrowawayKey;
  /** The version it is. */
  version: string;
  /** The version xomoni.com says is out: the next one. */
  next: string;
}

const test = base.extend<{ trustsReleaseKey: boolean }, { releaseKey: ThrowawayKey; trusted: Trusted }>({
  // Every test but S305-01 installs the build that trusts the throwaway key.
  trustsReleaseKey: [true, { option: true }],
  // One key for each worker, made as it starts and never kept.
  releaseKey: [throwawayKey(), { scope: 'worker' }],
  trusted: [
    async ({ releaseKey }, provide) => {
      const dir = buildTrusting(releaseKey.publicKey);
      const files = buildFiles(dir);
      const version = String(manifestOf(files).version);
      await provide({ dir, files, key: releaseKey, version, next: nextVersion(version) });
      rmSync(dir, { recursive: true, force: true });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  extensionBuild: async ({ trustsReleaseKey, trusted, extensionBuild }, provide) => {
    await provide(trustsReleaseKey ? trusted.dir : extensionBuild);
  },
});

/** The name of the folder the picker gives in these tests, as Chrome shows a folder's name. */
const FOLDER = 'xomoni';

/** A release of `files` at the next version, zipped and signed with the worker's key: what GitHub serves. */
function signedRelease(
  trusted: Trusted,
  change?: (manifest: Record<string, unknown>) => Record<string, unknown>,
): { zip: Buffer; signature: Buffer } {
  const zip = zipOf(releaseOf(trusted.files, trusted.next, change));
  return { zip, signature: trusted.key.sign(zip) };
}

/**
 * Makes the browser's folder picker, in `dashboard`, give the folder `name` in the browser's private file system, holding
 * `files`: the person's answer to Chrome's picker, which Playwright can't give. The folder is made afresh.
 */
async function pickerGives(dashboard: Page, files: readonly ReleaseFile[], name = FOLDER) {
  await dashboard.evaluate(
    async ({ name, files }) => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      const folder = await root.getDirectoryHandle(name, { create: true });
      for (const { path, data } of files) {
        const parts = path.split('/');
        let dir = folder;
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
        const file = await dir.getFileHandle(parts[parts.length - 1] ?? '', { create: true });
        const writable = await file.createWritable();
        await writable.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
        await writable.close();
      }
      Object.assign(window, { showDirectoryPicker: () => Promise.resolve(folder) });
    },
    { name, files: files.map((file) => ({ path: file.path, data: file.data.toString('base64') })) },
  );
}

/** Makes the folder picker, in `dashboard`, end as when the person closes it without choosing. */
async function pickerClosed(dashboard: Page) {
  await dashboard.evaluate(() => {
    Object.assign(window, {
      showDirectoryPicker: () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError')),
    });
  });
}

/** The manifest of the folder `name` in the browser's private file system, as the update left it. */
function folderManifest(dashboard: Page, name = FOLDER): Promise<Record<string, unknown>> {
  return dashboard.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle(name);
    const file = await (await folder.getFileHandle('manifest.json')).getFile();
    return JSON.parse(await file.text()) as Record<string, unknown>;
  }, name);
}

/**
 * Makes `dashboard`'s browser name itself as it does for a person, `Chrome/<version>`: the tests' headless browser says
 * `HeadlessChrome/<version>`, in which Xomoni can't read the version a release's `minimum_chrome_version` is checked
 * against.
 */
async function asChrome(dashboard: Page) {
  await dashboard.evaluate(() => {
    const agent = navigator.userAgent.replace('HeadlessChrome/', 'Chrome/');
    Object.defineProperty(navigator, 'userAgent', { get: () => agent, configurable: true });
  });
}

/**
 * Plays, in `dashboard`, the parts of Chrome the tests can't drive: its prompt for GitHub's access, answered `github`
 * (yes or no) as the person would, and its restart of Xomoni, counted instead (Chrome blocks an extension the tests
 * installed through its developer tools once it restarts itself). Also names the browser as it does for a person
 * (`asChrome`). What Xomoni asked and gave back is in `prompts`, the restarts in `restarts`.
 */
async function standIns(dashboard: Page, { github }: { github: boolean }) {
  await asChrome(dashboard);
  await dashboard.evaluate((allow) => {
    const asked: string[] = [];
    const { chrome } = window as unknown as { chrome: { permissions: object; runtime: object } };
    Object.assign(window, { xomoniPrompts: asked, xomoniRestarts: 0 });
    Object.assign(chrome.permissions, {
      request: ({ origins }: { origins: string[] }) => {
        asked.push(`request ${origins.join(' ')}`);
        return Promise.resolve(allow);
      },
      remove: ({ origins }: { origins: string[] }) => {
        asked.push(`remove ${origins.join(' ')}`);
        return Promise.resolve(true);
      },
    });
    Object.assign(chrome.runtime, {
      reload: () => {
        const counted = window as unknown as { xomoniRestarts: number };
        counted.xomoniRestarts += 1;
      },
    });
  }, github);
}

/** What Xomoni asked Chrome for, and gave back, under `standIns`: `request …` and `remove …` lines, in order. */
const prompts = (dashboard: Page) =>
  dashboard.evaluate(() => (window as unknown as { xomoniPrompts: string[] }).xomoniPrompts);

/** How many times Xomoni asked Chrome to restart it, under `standIns`. */
const restarts = (dashboard: Page) =>
  dashboard.evaluate(() => (window as unknown as { xomoniRestarts: number }).xomoniRestarts);

/** What Xomoni asks Chrome for, and gives back, to download a release: GitHub and its asset host. */
const GITHUB_ACCESS = 'https://github.com/* https://release-assets.githubusercontent.com/*';

/** Settings' card *Updates*. */
const updatesCard = (dashboard: Page): Locator =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { level: 2, name: 'Updates' }) });

/** The notice above every page that a newer version is out. */
const notice = (dashboard: Page, version: string): Locator =>
  dashboard.locator('[data-tone]').filter({ hasText: `Xomoni ${version} is out` });

/**
 * The person's start: the X window open and their profile's posts browsed, so Xomoni knows the account, and xomoni.com
 * signed in, which says `latest` is the newest release. Returns xomoni.com as the test sees it.
 */
async function connected(
  dashboard: Page,
  context: BrowserContext,
  extensionId: string,
  latest: string,
): Promise<XomoniSite> {
  const site = await serveXomoniSite(context, { release: { latest, security: false } });
  await openXWindow(dashboard);
  await browseProfile(await context.newPage(), ['posts']);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  await dashboard.bringToFront();
  return site;
}

/** Chooses the folder in Settings › Updates, the picker giving one with `files` (this Xomoni's, unless given). */
async function chooseFolder(dashboard: Page, files: readonly ReleaseFile[], name = FOLDER) {
  await openPage(dashboard, 'Settings');
  await pickerGives(dashboard, files, name);
  await updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' }).click();
}

/**
 * Xomoni connected, told `trusted.next` is out, its folder chosen from the notice, and Chrome's parts played
 * (`standIns`, GitHub's access allowed unless `github` says no): one click from an update. GitHub serves `release`
 * (a signed release of the next version unless given). Returns the notice and the URLs GitHub was asked for.
 */
async function readyToUpdate(
  {
    dashboard,
    context,
    extensionId,
    trusted,
  }: { dashboard: Page; context: BrowserContext; extensionId: string; trusted: Trusted },
  {
    release = signedRelease(trusted),
    github = true,
  }: { release?: { zip: GitHubAnswer; signature: GitHubAnswer }; github?: boolean } = {},
): Promise<{ update: Locator; asked: string[] }> {
  const asked = await serveRelease(context, trusted.next, release);
  await connected(dashboard, context, extensionId, trusted.next);
  const update = notice(dashboard, trusted.next);
  await pickerGives(dashboard, trusted.files);
  await update.getByRole('button', { name: 'Set up one-click updates' }).click();
  await expect(update.getByRole('button', { name: 'Update now' })).toBeEnabled();
  await standIns(dashboard, { github });
  return { update, asked };
}

/** Presses *Update now* and waits for why it stopped, the notice's alert, which it returns. */
async function updateRefused(update: Locator): Promise<Locator> {
  await update.getByRole('button', { name: 'Update now' }).click();
  const problem = update.getByRole('alert');
  await expect(problem).toBeVisible();
  return problem;
}

/** The activity log's lines, under Activity › Log. */
async function openLog(dashboard: Page): Promise<Locator> {
  await openPage(dashboard, 'Activity');
  await dashboard.getByRole('tab', { name: 'Log' }).click();
  return dashboard.getByRole('main');
}

/**
 * A cleanup of the account's two posts started, with the risks accepted, that waits for active hours two hours from
 * now: a job that runs. Returns its card under Activity.
 */
async function waitingCleanup(dashboard: Page): Promise<Locator> {
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
  const card = jobCard(dashboard, 'Delete posts older than Jan 1, 2022');
  await expect(card).toContainText('Outside active hours');
  return card;
}

/** The release URLs of the next version, in the order the update asks for them. */
const bothFiles = (trusted: Trusted) => [releaseUrls(trusted.next).zip, releaseUrls(trusted.next).signature];

test.describe('update in one click', { tag: '@task-305' }, () => {
  // A worker's first test builds Xomoni trusting the worker's key first, about ten seconds more.
  test.describe.configure({ timeout: 90_000 });

  test.describe('the build people have today, which trusts no key yet', () => {
    test.use({ trustsReleaseKey: false });

    test('S305-01 says to update by hand, and never asks GitHub for anything', async ({
      dashboard,
      context,
      extensionId,
    }) => {
      const github = await serveRelease(context, '9.9.9', { zip: 404, signature: 404 });
      await connected(dashboard, context, extensionId, '9.9.9');
      const update = notice(dashboard, '9.9.9');
      const byHand =
        'This version of Xomoni can’t check releases yet. Download the new version by hand; the next ones can update in one click.';
      await expect(update).toContainText(byHand);
      await expect(update.getByRole('link', { name: 'Download 9.9.9' })).toHaveAttribute(
        'href',
        'https://github.com/pirdehi/xomoni/releases/latest',
      );
      await expect(update.getByRole('button', { name: /Update now|Set up one-click updates/ })).toHaveCount(0);

      await openPage(dashboard, 'Settings');
      await expect(updatesCard(dashboard)).toContainText(byHand);
      await expect(updatesCard(dashboard).getByRole('button')).toHaveCount(0);
      expect(github, 'requests to GitHub').toEqual([]);
    });
  });

  test('S305-02 with a trusted key, Settings sets up one-click updates with Xomoni’s folder', async ({
    dashboard,
    trusted,
  }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    const card = updatesCard(dashboard);
    await expect(card).toContainText(`This browser runs Xomoni ${trusted.version}.`);
    await expect(card).toContainText(
      'When a new version is out, Xomoni can update itself in one click: it downloads the release from GitHub, checks its signature and every file, writes it into its own folder, never while a job runs, and restarts. Your data stays.',
    );
    await pickerGives(dashboard, trusted.files);
    await card.getByRole('button', { name: 'Choose Xomoni’s folder' }).click();
    await expect(dashboard.getByRole('status', { name: 'Notifications' })).toContainText(
      `Xomoni will update itself in “${FOLDER}”.`,
    );
    await expect(card).toContainText(`Xomoni’s folder: “${FOLDER}”`);
    await expect(card.getByRole('button', { name: 'Choose another folder' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Forget the folder' })).toBeVisible();
  });

  test('S305-03 Update now downloads the signed release, checks it and writes it into Xomoni’s folder', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    const release = signedRelease(trusted);
    const { update, asked } = await readyToUpdate({ dashboard, context, extensionId, trusted }, { release });
    await expect(update).toContainText(`This browser runs ${trusted.version}.`);

    await update.getByRole('button', { name: 'Update now' }).click();
    await expect.poll(() => restarts(dashboard)).toBe(1);
    await expect(update).toContainText(`Restarting as Xomoni ${trusted.next}…`);
    await expect(update.getByRole('button', { name: 'Update now' })).toBeDisabled();
    expect(asked).toEqual(bothFiles(trusted));
    expect(await folderManifest(dashboard)).toMatchObject({
      version: trusted.next,
      name: manifestOf(trusted.files).name,
    });
    await expect(await openLog(dashboard)).toContainText(
      `Updated Xomoni from ${trusted.version} to ${trusted.next}: the release’s signature checked out (key ${trusted.key.publicKey.slice(0, 8)}…, zip SHA-256 ${sha256(release.zip)}), ${String(trusted.files.length)} files written. Xomoni restarts now.`,
    );
  });

  test('S305-04 after the restart, Xomoni says which version runs, and the data is all there', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    const { update } = await readyToUpdate({ dashboard, context, extensionId, trusted });
    await update.getByRole('button', { name: 'Update now' }).click();
    await expect.poll(() => restarts(dashboard)).toBe(1);

    // Chrome opens the dashboard again after the restart. It runs Xomoni from its own folder, not the one the tests'
    // picker gave, so the version is still the one before, and Xomoni says so.
    await dashboard.reload();
    await expect(dashboard.getByRole('status', { name: 'Notifications' })).toContainText(
      `Xomoni ${trusted.next} was written, but Chrome still runs ${trusted.version}: it loads Xomoni from another folder. Choose that folder in Settings › Updates.`,
    );
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(dashboard.getByRole('region', { name: 'Counts' })).toContainText(/Posts\s*2/);
  });

  test('S305-06 the folder chosen or forgotten in Settings changes the notice at once', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    await connected(dashboard, context, extensionId, trusted.next);
    const update = notice(dashboard, trusted.next);
    await expect(update.getByRole('button', { name: 'Set up one-click updates' })).toBeVisible();
    await chooseFolder(dashboard, trusted.files);
    await expect(updatesCard(dashboard)).toContainText(`Xomoni’s folder: “${FOLDER}”`);
    await expect(update.getByRole('button', { name: 'Update now' })).toBeEnabled();

    await updatesCard(dashboard).getByRole('button', { name: 'Forget the folder' }).click();
    await expect(updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' })).toBeVisible();
    await expect(update.getByRole('button', { name: 'Set up one-click updates' })).toBeVisible();
    await expect(update.getByRole('button', { name: 'Update now' })).toHaveCount(0);
  });

  test.describe('a folder or a release that isn’t right', () => {
    test('S305-07 a folder that isn’t Xomoni’s is refused, and nothing is kept', async ({ dashboard }) => {
      await openXWindow(dashboard);
      await chooseFolder(dashboard, [{ path: 'holiday.jpg', data: Buffer.from('not a manifest') }], 'photos');
      await expect(updatesCard(dashboard).getByRole('alert')).toHaveText(
        '“photos” isn’t Xomoni’s folder: it has no Xomoni manifest.json. Choose the folder you loaded Xomoni from: chrome://extensions shows it in Xomoni’s Details, under Source.',
      );
      await expect(updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' })).toBeVisible();
      await expect(updatesCard(dashboard)).not.toContainText('Xomoni’s folder: “');
    });

    test('S305-08 a folder holding another version is refused, and nothing is kept', async ({ dashboard, trusted }) => {
      await openXWindow(dashboard);
      await chooseFolder(dashboard, releaseOf(trusted.files, '0.0.1'));
      await expect(updatesCard(dashboard).getByRole('alert')).toHaveText(
        `“${FOLDER}” holds Xomoni 0.0.1, but this one is ${trusted.version}. Choose the folder you loaded Xomoni from: chrome://extensions shows it in Xomoni’s Details, under Source.`,
      );
      await expect(updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' })).toBeVisible();
    });

    test('S305-09 a download that says it is another version is thrown away, and nothing is written', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const zip = zipOf(releaseOf(trusted.files, nextVersion(trusted.next)));
      const { update } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: { zip, signature: trusted.key.sign(zip) } },
      );
      await expect(await updateRefused(update)).toHaveText(
        `The download says it is another version than ${trusted.next}, so it was thrown away. Nothing was changed.`,
      );
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
      expect(await restarts(dashboard)).toBe(0);
    });

    test('S305-10 a download with a file outside Xomoni’s folder is thrown away, and nothing is written', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const files = [
        { path: '../evil.js', data: Buffer.from('// outside') },
        ...releaseOf(trusted.files, trusted.next),
      ];
      const zip = zipOf(files);
      const { update } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: { zip, signature: trusted.key.sign(zip) } },
      );
      await expect(await updateRefused(update)).toHaveText(
        `The download of Xomoni ${trusted.next} isn’t a complete, safe Xomoni, so it was thrown away. Nothing was changed.`,
      );
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
    });

    test('S305-11 a release that needs a newer browser waits for it, and nothing is written', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const { update } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: signedRelease(trusted, (m) => ({ ...m, minimum_chrome_version: '999' })) },
      );
      await expect(await updateRefused(update)).toHaveText(
        `Xomoni ${trusted.next} needs a newer browser than this one. Update your browser first (Chrome: Settings › About Chrome), then update Xomoni. Nothing was changed.`,
      );
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
    });
  });

  test.describe('when GitHub or the folder fails', () => {
    test('S305-12 GitHub out of reach: nothing is changed, and the log says why', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const { update, asked } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: { zip: 'offline', signature: 'offline' } },
      );
      const download = `Couldn’t download Xomoni ${trusted.next} from GitHub. Check the connection and try again. Nothing was changed.`;
      await expect(await updateRefused(update)).toHaveText(download);
      expect(asked).toEqual([releaseUrls(trusted.next).zip]);
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
      // GitHub's access is given back all the same.
      expect(await prompts(dashboard)).toEqual([`request ${GITHUB_ACCESS}`, `remove ${GITHUB_ACCESS}`]);
      await expect(await openLog(dashboard)).toContainText(`Couldn’t update Xomoni to ${trusted.next}. ${download}`);
    });

    test('S305-13 GitHub answering with an error: nothing is changed, and Update now can be pressed again', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const { update } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: { zip: 502, signature: 502 } },
      );
      await expect(await updateRefused(update)).toHaveText(
        `Couldn’t download Xomoni ${trusted.next} from GitHub. Check the connection and try again. Nothing was changed.`,
      );
      await expect(update.getByRole('button', { name: 'Update now' })).toBeEnabled();
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
    });

    test('S305-14 a folder that changed since it was chosen is refused, and asked for again', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const { update, asked } = await readyToUpdate({ dashboard, context, extensionId, trusted });
      // The person put another copy of Xomoni in that folder since.
      await dashboard.evaluate(async (name) => {
        const root = await navigator.storage.getDirectory();
        const folder = await root.getDirectoryHandle(name);
        const writable = await (await folder.getFileHandle('manifest.json')).createWritable();
        await writable.write(JSON.stringify({ name: 'Xomoni', version: '0.0.1' }));
        await writable.close();
      }, FOLDER);
      await expect(await updateRefused(update)).toHaveText(
        `The folder chosen doesn’t hold Xomoni ${trusted.version} any more. Choose the folder Chrome loads Xomoni from. Chrome shows it on chrome://extensions: open Xomoni’s Details, and look under Source for where it was loaded from.`,
      );
      await expect(update.getByRole('button', { name: 'Choose Xomoni’s folder again' })).toBeVisible();
      expect(asked, 'requests to GitHub').toEqual([]);
    });
  });

  test.describe('what Xomoni never installs', () => {
    test('S305-15 a release signed by another key is thrown away, and the log says so', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const zip = zipOf(releaseOf(trusted.files, trusted.next));
      const { update } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: { zip, signature: throwawayKey().sign(zip) } },
      );
      const thrown = `The download of Xomoni ${trusted.next} isn’t signed by Xomoni’s release key, so it was thrown away. Nothing was changed.`;
      await expect(await updateRefused(update)).toHaveText(thrown);
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
      expect(await restarts(dashboard)).toBe(0);
      await expect(await openLog(dashboard)).toContainText(`Couldn’t update Xomoni to ${trusted.next}. ${thrown}`);
    });

    test('S305-16 a release changed after it was signed is thrown away, and nothing is written', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const { zip, signature } = signedRelease(trusted);
      const changed = Buffer.from(zip);
      changed[changed.length - 30] = (changed[changed.length - 30] ?? 0) ^ 0xff;
      const { update } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: { zip: changed, signature } },
      );
      await expect(await updateRefused(update)).toHaveText(
        `The download of Xomoni ${trusted.next} isn’t signed by Xomoni’s release key, so it was thrown away. Nothing was changed.`,
      );
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
    });

    test('S305-17 a release with no signature is not installed', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const { zip } = signedRelease(trusted);
      const { update, asked } = await readyToUpdate(
        { dashboard, context, extensionId, trusted },
        { release: { zip, signature: 404 } },
      );
      await expect(await updateRefused(update)).toHaveText(
        `Xomoni ${trusted.next} on GitHub has no signature, so Xomoni won’t install it. Nothing was changed.`,
      );
      expect(asked).toEqual(bothFiles(trusted));
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
    });

    test('S305-18 a release asking for more access, or with another identity, is left to install by hand', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const wider = signedRelease(trusted, (m) => ({
        ...m,
        permissions: [...((m.permissions as string[] | undefined) ?? []), 'tabs', 'history'],
      }));
      const { update } = await readyToUpdate({ dashboard, context, extensionId, trusted }, { release: wider });
      await expect(await updateRefused(update)).toHaveText(
        `Xomoni ${trusted.next} asks for more access than ${trusted.version}, so it can’t update in one click. Download it and load it by hand: Chrome then shows what it asks for. Nothing was changed.`,
      );
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });

      // Another `key`: another extension to Chrome, which would leave the data behind.
      const other = signedRelease(trusted, (m) => ({ ...m, key: Buffer.from('another extension').toString('base64') }));
      await serveRelease(context, trusted.next, other);
      await expect(await updateRefused(update)).toHaveText(
        `Xomoni ${trusted.next} is a new extension to Chrome, so updating in place would leave your data behind. Export your data first (Settings › Move your data), then install ${trusted.next} by hand and import it there.`,
      );
      expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
    });

    test('S305-19 GitHub is asked only on the person’s click, for the release only, and its access given back', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      // On install, Xomoni has no access to GitHub at all.
      const granted = await dashboard.evaluate(async () => {
        const { chrome } = window as unknown as {
          chrome: { permissions: { getAll(): Promise<{ origins?: string[] }> } };
        };
        return (await chrome.permissions.getAll()).origins ?? [];
      });
      expect(granted.filter((origin) => origin.includes('github'))).toEqual([]);
      const { update, asked } = await readyToUpdate({ dashboard, context, extensionId, trusted });
      // Set up, connected and told of a new version: still nothing asked of GitHub.
      expect(asked).toEqual([]);
      expect(await prompts(dashboard)).toEqual([]);

      await update.getByRole('button', { name: 'Update now' }).click();
      await expect.poll(() => restarts(dashboard)).toBe(1);
      expect(asked).toEqual(bothFiles(trusted));
      expect(await prompts(dashboard)).toEqual([`request ${GITHUB_ACCESS}`, `remove ${GITHUB_ACCESS}`]);
    });

    test('S305-20 while a job runs, Update now waits until it is paused', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      const { update, asked } = await readyToUpdate({ dashboard, context, extensionId, trusted });
      const card = await waitingCleanup(dashboard);
      await expect(update.getByRole('button', { name: 'Update now' })).toBeDisabled();
      await expect(update).toContainText('Xomoni updates only while no job runs.');
      expect(asked).toEqual([]);

      await card.getByRole('button', { name: 'Pause' }).click();
      await expect(update.getByRole('button', { name: 'Update now' })).toBeEnabled();
      await expect(update).not.toContainText('Xomoni updates only while no job runs.');
    });
  });

  test('S305-21 before Xomoni’s folder is chosen, the notice offers to set up one-click updates', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    await connected(dashboard, context, extensionId, trusted.next);
    const update = notice(dashboard, trusted.next);
    await expect(update.getByRole('button', { name: 'Set up one-click updates' })).toBeEnabled();
    await expect(update).toContainText(
      'Once: choose the folder you loaded Xomoni from, and let Xomoni change it. Each update is then one click: the new version comes from GitHub, its signature is checked, and your data stays.',
    );
    await expect(update.getByRole('button', { name: 'Update now' })).toHaveCount(0);
    await openPage(dashboard, 'Settings');
    await expect(updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' })).toBeVisible();
  });

  test('S305-22 with no newer version out, there is nothing to update', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    const site = await connected(dashboard, context, extensionId, trusted.version);
    expect(site.calls.map((call) => call.fn)).toContain('device_report');
    await openPage(dashboard, 'Settings');
    await expect(updatesCard(dashboard)).toContainText(`This browser runs Xomoni ${trusted.version}.`);
    await expect(dashboard.getByText(/^Xomoni \S+ is out/)).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: /Update now|Set up one-click updates/ })).toHaveCount(0);
  });

  test('S305-23 closing the folder picker keeps nothing and says nothing', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    await pickerClosed(dashboard);
    await updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' }).click();
    await expect(updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' })).toBeEnabled();
    await expect(updatesCard(dashboard).getByRole('alert')).toHaveCount(0);
    await expect(updatesCard(dashboard)).not.toContainText('Xomoni’s folder: “');
  });

  test('S305-24 declining GitHub’s access stops the update before anything is downloaded', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    const { update, asked } = await readyToUpdate({ dashboard, context, extensionId, trusted }, { github: false });
    await expect(await updateRefused(update)).toHaveText(
      'Xomoni needs your OK to download its releases from GitHub. Nothing was changed.',
    );
    expect(asked, 'requests to GitHub').toEqual([]);
    expect(await folderManifest(dashboard)).toMatchObject({ version: trusted.version });
    await expect(update.getByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  test('S305-25 Not now puts the notice away until a newer version, and Forget the folder forgets it', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    await connected(dashboard, context, extensionId, trusted.next);
    await chooseFolder(dashboard, trusted.files);
    await updatesCard(dashboard).getByRole('button', { name: 'Forget the folder' }).click();
    await expect(updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' })).toBeVisible();
    await dashboard.reload();
    await expect(updatesCard(dashboard).getByRole('button', { name: 'Choose Xomoni’s folder' })).toBeVisible();

    await notice(dashboard, trusted.next).getByRole('button', { name: 'Not now' }).click();
    await expect(notice(dashboard, trusted.next)).toHaveCount(0);
    await dashboard.reload();
    await expect(updatesCard(dashboard)).toBeVisible();
    await expect(notice(dashboard, trusted.next)).toHaveCount(0);
  });

  test('S305-26 the setup and the update work with the keyboard alone', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    await serveRelease(context, trusted.next, signedRelease(trusted));
    await connected(dashboard, context, extensionId, trusted.next);
    const update = notice(dashboard, trusted.next);
    await pickerGives(dashboard, trusted.files);
    await standIns(dashboard, { github: true });
    await tabTo(update.getByRole('button', { name: 'Set up one-click updates' }));
    await dashboard.keyboard.press('Enter');
    const now = update.getByRole('button', { name: 'Update now' });
    await expect(now).toBeEnabled();
    await tabTo(now);
    await dashboard.keyboard.press('Enter');
    await expect.poll(() => restarts(dashboard)).toBe(1);
  });

  test('S305-27 the card, the notice and a refusal have no serious accessibility violation', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    const zip = zipOf(releaseOf(trusted.files, trusted.next));
    const { update } = await readyToUpdate(
      { dashboard, context, extensionId, trusted },
      { release: { zip, signature: throwawayKey().sign(zip) } },
    );
    await openPage(dashboard, 'Settings');
    await expectNoSeriousA11yViolations(dashboard);
    // The refusal is an alert, read out as it shows.
    await updateRefused(update);
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S305-28 the notice and the card read well, with no serious violation', async ({
      dashboard,
      context,
      extensionId,
      trusted,
    }) => {
      await connected(dashboard, context, extensionId, trusted.next);
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await expect(notice(dashboard, trusted.next)).toBeVisible();
      await chooseFolder(dashboard, trusted.files);
      await expect(updatesCard(dashboard)).toContainText(`Xomoni’s folder: “${FOLDER}”`);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S305-29 the folder is remembered after a reload and in a second tab', async ({
    dashboard,
    context,
    extensionId,
    trusted,
  }) => {
    await connected(dashboard, context, extensionId, trusted.next);
    await chooseFolder(dashboard, trusted.files);
    await expect(updatesCard(dashboard)).toContainText(`Xomoni’s folder: “${FOLDER}”`);

    await dashboard.reload();
    await expect(updatesCard(dashboard)).toContainText(`Xomoni’s folder: “${FOLDER}”`);
    await expect(notice(dashboard, trusted.next).getByRole('button', { name: 'Update now' })).toBeEnabled();
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await expect(updatesCard(second)).toContainText(`Xomoni’s folder: “${FOLDER}”`);
    await expect(notice(second, trusted.next).getByRole('button', { name: 'Update now' })).toBeEnabled();
  });
});
