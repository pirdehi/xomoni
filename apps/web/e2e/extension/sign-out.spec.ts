import { readFileSync } from 'node:fs';
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
  risksDialog,
  startCleanup,
  workAnyTime,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT, servePage, setXSession } from '../support/x-fixtures';
import { CLOUD_URL, SITE_ACCOUNT, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// Sign out of Xomoni (docs/scenarios/226-sign-out.md, #226, #232, #345): the dialog that names the account and says what
// happens, the choices to remove the account's data (with a copy first) and to sign out of X on X's own page, the
// signed-out page and signing in again, in the built extension in a real browser on x.com served from synthetic
// fixtures (ADR-0040). xomoni.com, which a sign-out signs out too, is played at the extension (`serveXomoniSite`).

/** The sidebar's account button, which opens Connections. */
const accountButton = (dashboard: Page, handle: string = FIXTURE_ACCOUNT.handle): Locator =>
  dashboard.getByRole('complementary').getByRole('button', { name: new RegExp(` @${handle}$`) });

/** The sign-out dialog. */
const signOutDialog = (dashboard: Page): Locator => dashboard.getByRole('dialog', { name: 'Sign out of Xomoni?' });

/** What the dialog says signing out does, one item each. */
const effects = (dashboard: Page): Locator =>
  signOutDialog(dashboard).getByRole('list', { name: 'What signing out does' }).getByRole('listitem');

/** The choice to remove the account's data from this browser. */
const removeData = (dashboard: Page, handle: string = FIXTURE_ACCOUNT.handle): Locator =>
  signOutDialog(dashboard).getByRole('checkbox', { name: `Remove @${handle}’s data from this browser` });

/** The choice to also sign out of X, on X's own page. */
const alsoX = (dashboard: Page): Locator =>
  signOutDialog(dashboard).getByRole('checkbox', { name: 'Also sign out of X' });

/** The dashboard's toasts. */
const toasts = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'Notifications' });

/** The page Xomoni shows while signed out. */
const signedOutHeading = (dashboard: Page): Locator =>
  dashboard.getByRole('heading', { level: 1, name: 'You’re signed out' });

/** Opens the account panel from the sidebar and presses *Sign out of Xomoni*: the dialog opens. */
async function openSignOut(dashboard: Page) {
  await dashboard.bringToFront();
  await accountButton(dashboard).click();
  await dashboard
    .getByRole('dialog', { name: 'Connections' })
    .getByRole('button', { name: 'Sign out of Xomoni', exact: true })
    .click();
  await expect(signOutDialog(dashboard)).toBeVisible();
}

/** Signs out with the dialog's choices as given, and waits for the signed-out page. */
async function signOut(dashboard: Page, choice: { removeData?: boolean; signOutOfX?: boolean } = {}) {
  await openSignOut(dashboard);
  if (choice.removeData) await removeData(dashboard).check();
  if (choice.signOutOfX) await alsoX(dashboard).check();
  const name = choice.removeData ? 'Sign out and remove data' : 'Sign out';
  await signOutDialog(dashboard).getByRole('button', { name, exact: true }).click();
  await expect(signedOutHeading(dashboard)).toBeVisible();
}

/** The person's start: the X window open and their profile's posts browsed. Returns the X window. */
async function withAccount(dashboard: Page, page: Page): Promise<Page> {
  const x = await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await dashboard.bringToFront();
  return x;
}

/** The job a cleanup of the fixture account's two posts, both before Jan 1, 2022, becomes. */
const BEFORE_2022 = 'Delete posts older than Jan 1, 2022';

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
  const card = jobCard(dashboard, BEFORE_2022);
  await expect(card).toContainText('Outside active hours');
  return card;
}

/**
 * On the signed-out page, where Xomoni has closed its X window: opens it again, and presses *Continue as @handle*, for
 * the account the X window is signed in to. The dashboard then shows the page it was on, with the account.
 */
async function continueAs(dashboard: Page, handle: string = FIXTURE_ACCOUNT.handle) {
  await dashboard.bringToFront();
  await dashboard.getByRole('main').getByRole('button', { name: 'Open X window' }).click();
  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: `Continue as @${handle}` }).click();
  await expect(toasts(dashboard)).toContainText(`Signed in as @${handle}`);
  await expect(signedOutHeading(dashboard)).toHaveCount(0);
}

/** Opens Home, and returns its counts. */
async function homeCounts(dashboard: Page): Promise<Locator> {
  await openPage(dashboard, 'Home');
  return dashboard.getByRole('region', { name: 'Counts' });
}

/** xomoni.com played at the extension, and Xomoni signed in to it from a xomoni.com page. */
async function signedInToXomoniCom(context: BrowserContext, extensionId: string): Promise<XomoniSite> {
  const site = await serveXomoniSite(context);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  return site;
}

test.describe('sign out of Xomoni', { tag: '@task-226' }, () => {
  test('S226-01 the dialog names the account and says what happens, and Sign out keeps the data', async ({
    dashboard,
    page,
  }) => {
    const x = await withAccount(dashboard, page);
    await openSignOut(dashboard);
    const dialog = signOutDialog(dashboard);
    await expect(dialog).toContainText(`${FIXTURE_ACCOUNT.name}@${FIXTURE_ACCOUNT.handle} on X`);
    await expect(effects(dashboard)).toHaveText([
      'The X window Xomoni opened closes, and Xomoni stops recording what X shows until you sign in again.',
    ]);
    await expect(removeData(dashboard)).not.toBeChecked();
    await expect(alsoX(dashboard)).not.toBeChecked();

    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await expect(toasts(dashboard)).toContainText(
      `Signed out of Xomoni. @${FIXTURE_ACCOUNT.handle} is no longer used in this browser.`,
    );
    await expect(dashboard.getByRole('main')).toContainText(
      `Xomoni isn’t working on any X account in this browser. @${FIXTURE_ACCOUNT.handle}’s data is still here, ready when you sign in again.`,
    );
    await expect.poll(() => x.isClosed(), { message: 'the X window closes' }).toBe(true);
    await expect(accountButton(dashboard)).toHaveCount(0);
  });

  test('S226-02 Continue as @handle signs in again, with the data as it was', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await signOut(dashboard);
    await expect(dashboard.getByRole('main')).toContainText('The account the X window is signed in to appears here.');
    await continueAs(dashboard);
    await expect(await homeCounts(dashboard)).toContainText(/Posts\s*2/);
    await expect(accountButton(dashboard)).toBeVisible();
  });

  test('S226-03 a running job pauses, and continues where it stopped once the person signs in again', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await waitingCleanup(dashboard);
    await openSignOut(dashboard);
    await expect(effects(dashboard).first()).toHaveText(
      `“${BEFORE_2022}” pauses. It continues where it stopped when you sign in again.`,
    );
    await signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(signedOutHeading(dashboard)).toBeVisible();

    await continueAs(dashboard);
    await openPage(dashboard, 'Activity');
    const card = jobCard(dashboard, BEFORE_2022);
    await expect(card.getByRole('button', { name: 'Resume' })).toBeEnabled();
    await expect(card).toContainText('2 remaining');
  });

  test('S226-04 Sign out and remove data leaves nothing of the account in this browser', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await openSignOut(dashboard);
    await removeData(dashboard).check();
    await expect(signOutDialog(dashboard).getByRole('button', { name: 'Sign out and remove data' })).toBeVisible();
    await signOutDialog(dashboard).getByRole('button', { name: 'Sign out and remove data' }).click();
    await expect(dashboard.getByRole('main')).toContainText(
      `@${FIXTURE_ACCOUNT.handle}’s data was removed from this browser.`,
    );

    await continueAs(dashboard);
    await expect(await homeCounts(dashboard)).toContainText(/Posts\s*0/);
  });

  test('S226-05 Download a copy first saves the account’s data, in a file Xomoni can import', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await openSignOut(dashboard);
    const saved = dashboard.waitForEvent('download');
    await signOutDialog(dashboard).getByRole('button', { name: 'Download a copy first' }).click();
    const download = await saved;
    const d = new Date();
    const day = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(download.suggestedFilename()).toBe(`xomoni-${FIXTURE_ACCOUNT.handle}-${day}.json`);
    const file = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
      format: string;
      data: { accounts: { id: string }[]; items: unknown[] };
    };
    expect(file.format).toBe('xomoni-export');
    expect(file.data.accounts.map((a) => a.id)).toEqual([FIXTURE_ACCOUNT.id]);
    expect(file.data.items).toHaveLength(2);
    // The dialog stays open, for the person to sign out once the copy is saved.
    await expect(signOutDialog(dashboard)).toBeVisible();
  });

  test('S226-06 Also sign out of X opens X’s own sign-out page, where X asks to confirm', async ({
    dashboard,
    page,
    context,
  }) => {
    await withAccount(dashboard, page);
    await signOut(dashboard, { signOutOfX: true });
    await expect
      .poll(() => context.pages().some((p) => p.url() === 'https://x.com/logout'), {
        message: 'X’s sign-out page opens',
      })
      .toBe(true);
    // Xomoni leaves X's session to X: its cookie is still there until the person confirms on X's page.
    expect((await context.cookies('https://x.com')).map((c) => c.name)).toContain('twid');
  });

  test('S226-07 connected to xomoni.com, the dialog says so, and signing out ends this browser’s access there', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await withAccount(dashboard, page);
    const site = await signedInToXomoniCom(context, extensionId);
    await openSignOut(dashboard);
    await expect(effects(dashboard)).toContainText([
      `xomoni.com signs out in this browser too (${SITE_ACCOUNT}), and this browser stops sending job status.`,
    ]);
    await signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await expect.poll(() => site.calls.map((call) => call.fn)).toContain('unpair_device');
    await expect(toasts(dashboard)).not.toContainText('Couldn’t reach xomoni.com');
  });

  test('S226-08 Continue as another X account takes that one up, apart from the first one’s data', async ({
    dashboard,
    page,
    context,
  }) => {
    await withAccount(dashboard, page);
    await signOut(dashboard);
    await setXSession(context, FRIEND_ACCOUNT.id);
    await continueAs(dashboard, FRIEND_ACCOUNT.handle);
    const counts = await homeCounts(dashboard);
    await expect(dashboard.getByRole('main')).toContainText(`@${FRIEND_ACCOUNT.handle} · everything Xomoni knows`);
    await expect(counts).toContainText(/Posts\s*0/);
  });

  test.describe('signed out of X too', () => {
    test.use({ xSignedIn: false });

    test('S226-09 with no one signed in to X, there is no account to continue as', async ({ dashboard, context }) => {
      // Signed in to X at first, then out of X in the X window as well.
      await setXSession(context, FIXTURE_ACCOUNT.id);
      await openXWindow(dashboard);
      await expect(accountButton(dashboard)).toBeVisible();
      await signOut(dashboard);
      await setXSession(context, null);
      await dashboard.getByRole('button', { name: 'Open X window' }).click();
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('main')).toContainText('The account the X window is signed in to appears here.');
      await expect(dashboard.getByRole('button', { name: /^Continue as/ })).toHaveCount(0);
    });
  });

  test('S226-10 xomoni.com out of reach: Xomoni signs out all the same, and forgets the link here', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await withAccount(dashboard, page);
    await signedInToXomoniCom(context, extensionId);
    await context.route(
      (url) => url.origin === CLOUD_URL,
      (route) => route.abort('internetdisconnected'),
    );
    await signOut(dashboard);
    await expect(toasts(dashboard)).toContainText(
      'Couldn’t reach xomoni.com, so this browser was forgotten here only. To end its access, remove it under Connected browsers on xomoni.com.',
    );
    await continueAs(dashboard);
    await accountButton(dashboard).click();
    await expect(
      dashboard.getByRole('dialog', { name: 'Connections' }).getByRole('region', { name: 'xomoni.com' }),
    ).toContainText('Not connected');
  });

  test('S226-11 with the X window already closed, signing out still finishes', async ({ dashboard, page }) => {
    const x = await withAccount(dashboard, page);
    await x.close();
    await expect(dashboard.getByRole('complementary').getByText('X window closed')).toBeVisible();
    await signOut(dashboard);
    await expect(toasts(dashboard)).toContainText(`Signed out of Xomoni. @${FIXTURE_ACCOUNT.handle}`);
    await expect(toasts(dashboard)).not.toContainText('Couldn’t finish signing out');
  });

  test('S226-12 X out of reach: Also sign out of X opens X’s page anyway, and Xomoni is signed out', async ({
    dashboard,
    page,
    context,
  }) => {
    await withAccount(dashboard, page);
    await context.route(
      (url) => url.host === 'x.com' && url.pathname === '/logout',
      (route) => route.abort('internetdisconnected'),
    );
    await signOut(dashboard, { signOutOfX: true });
    // The tab Xomoni opened for X's page shows the browser's error instead.
    await expect
      .poll(() => context.pages().some((p) => /^(https:\/\/x\.com\/logout|chrome-error:)/.test(p.url())))
      .toBe(true);
    await dashboard.bringToFront();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await expect(dashboard.getByRole('main')).toContainText(`@${FIXTURE_ACCOUNT.handle}’s data is still here`);
  });

  test.describe('with years of posts, replies and likes on X', () => {
    test.use({ xHistory: 'long' });

    test('S226-13 while signed out, nothing X shows is recorded', async ({ dashboard, page }) => {
      await openXWindow(dashboard);
      await browseProfile(page, ['posts']);
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('region', { name: 'Counts' })).toContainText(/Replies\s*0/);
      await signOut(dashboard);

      // The person browses their replies and likes on X while Xomoni is signed out.
      await browseProfile(page, ['replies', 'likes']);
      await continueAs(dashboard);
      const counts = await homeCounts(dashboard);
      await expect(counts).toContainText(/Posts\s*5/);
      await expect(counts).toContainText(/Replies\s*0/);
      await expect(counts).toContainText(/Likes\s*0/);
    });
  });

  test('S226-14 an X session left open doesn’t sign the person straight back in', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await signOut(dashboard);
    await dashboard.getByRole('button', { name: 'Open X window' }).click();
    await dashboard.bringToFront();
    await expect(dashboard.getByRole('button', { name: `Continue as @${FIXTURE_ACCOUNT.handle}` })).toBeVisible();
    // Signed in to X in that window, and still signed out of Xomoni, after a reload too.
    await dashboard.reload();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await expect(accountButton(dashboard)).toHaveCount(0);
  });

  test('S226-15 once the account’s data is removed, the risks are asked again before its next job', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2022-01-01');
    await expect.poll(() => matching(dashboard)).toBe(2);
    await continueWithoutArchive(dashboard);
    // The person read and accepted the risks for this account's first job.
    await startCleanup(dashboard);
    await signOut(dashboard, { removeData: true });

    await continueAs(dashboard);
    await browseProfile(page, ['posts']);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2022-01-01');
    await expect.poll(() => matching(dashboard)).toBe(2);
    await continueWithoutArchive(dashboard);
    await confirmCleanup(dashboard);
    await expect(risksDialog(dashboard)).toBeVisible();
  });

  test('S226-16 removing the data keeps X’s warnings: the account still rests after one', async ({
    dashboard,
    page,
    context,
  }) => {
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2022-01-01');
    await expect.poll(() => matching(dashboard)).toBe(2);
    await continueWithoutArchive(dashboard);
    await servePage(context, '/home', 'home-limited.html');
    await startCleanup(dashboard);
    await expect(
      jobCard(dashboard, BEFORE_2022).getByRole('button', { name: /^Resume in 1[12]h \d+m$/ }),
    ).toBeDisabled();

    await signOut(dashboard, { removeData: true });
    await continueAs(dashboard);
    await expect(await homeCounts(dashboard)).toContainText(/Posts\s*0/);
    const status = dashboard.getByRole('region', { name: 'Status' });
    await expect(status.getByRole('heading', { level: 2, name: 'Resting after a warning from X' })).toBeVisible();
  });

  test('S226-17 without a job or xomoni.com, the dialog says only what happens to the X window', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await openSignOut(dashboard);
    await expect(effects(dashboard)).toHaveCount(1);
    await expect(effects(dashboard)).toHaveText([
      'The X window Xomoni opened closes, and Xomoni stops recording what X shows until you sign in again.',
    ]);
    await expect(signOutDialog(dashboard)).toContainText(
      'The inventory, archive, jobs, Watch and activity log. Xomoni keeps its record of X’s limits, so they still hold.',
    );
  });

  test('S226-18 signed out with the X window closed, the page shows the way back in', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await signOut(dashboard);
    const main = dashboard.getByRole('main');
    await expect(main.getByRole('button', { name: 'Sign in to xomoni.com' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Open X window' })).toBeVisible();
    await expect(main).toContainText('The account the X window is signed in to appears here.');
    await expect(main.getByRole('button', { name: /^Continue as/ })).toHaveCount(0);
  });

  test('S226-19 Cancel signs nothing out: the X window and the job go on', async ({ dashboard, page }) => {
    const x = await withAccount(dashboard, page);
    const card = await waitingCleanup(dashboard);
    await openSignOut(dashboard);
    await signOutDialog(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(signOutDialog(dashboard)).toBeHidden();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(card).toContainText('Outside active hours');
    expect(x.isClosed()).toBe(false);
    await expect(accountButton(dashboard)).toBeVisible();
  });

  test('S226-20 Escape closes the dialog too, and its choices start afresh each time', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await openSignOut(dashboard);
    await removeData(dashboard).check();
    await alsoX(dashboard).check();
    await dashboard.keyboard.press('Escape');
    await expect(signOutDialog(dashboard)).toBeHidden();
    await openSignOut(dashboard);
    await expect(removeData(dashboard)).not.toBeChecked();
    await expect(alsoX(dashboard)).not.toBeChecked();
    await expect(signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await signOutDialog(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(accountButton(dashboard)).toBeVisible();
  });

  test('S226-21 signing out and back in works with the keyboard alone', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await tabTo(accountButton(dashboard));
    await dashboard.keyboard.press('Enter');
    const signOutButton = dashboard
      .getByRole('dialog', { name: 'Connections' })
      .getByRole('button', { name: 'Sign out of Xomoni', exact: true });
    await tabTo(signOutButton);
    await dashboard.keyboard.press('Enter');
    // The dialog opens on its Sign out button.
    await expect(signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
    await tabTo(removeData(dashboard));
    await dashboard.keyboard.press('Space');
    await expect(removeData(dashboard)).toBeChecked();
    await dashboard.keyboard.press('Space');
    await expect(removeData(dashboard)).not.toBeChecked();
    await tabTo(signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true }));
    await dashboard.keyboard.press('Enter');
    await expect(signedOutHeading(dashboard)).toBeVisible();

    await tabTo(dashboard.getByRole('button', { name: 'Open X window' }));
    await dashboard.keyboard.press('Enter');
    await dashboard.bringToFront();
    const again = dashboard.getByRole('button', { name: `Continue as @${FIXTURE_ACCOUNT.handle}` });
    await expect(again).toBeVisible();
    await tabTo(again);
    await dashboard.keyboard.press('Enter');
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  });

  test('S226-22 the dialog and the signed-out page have no serious accessibility violation', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await openSignOut(dashboard);
    await removeData(dashboard).check();
    await expectNoSeriousA11yViolations(dashboard);
    await removeData(dashboard).uncheck();
    await signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S226-23 the dialog and the signed-out page read well, with no serious violation', async ({
      dashboard,
      page,
    }) => {
      await withAccount(dashboard, page);
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await openSignOut(dashboard);
      await expectNoSeriousA11yViolations(dashboard);
      await signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(signedOutHeading(dashboard)).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S226-24 a sign-out holds after a reload and in every dashboard tab', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await withAccount(dashboard, page);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/library`);
    await expect(second.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();

    await signOut(dashboard);
    await expect(signedOutHeading(second)).toBeVisible();
    await dashboard.reload();
    await expect(signedOutHeading(dashboard)).toBeVisible();
    await expect(accountButton(dashboard)).toHaveCount(0);
  });

  test('S226-25 a sign-out in one tab pauses the job another tab runs', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await withAccount(dashboard, page);
    await waitingCleanup(dashboard);
    // The job runs in this first tab; the person signs out from a second one.
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/overview`);
    await expect(second.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await openSignOut(second);
    await expect(effects(second).first()).toHaveText(
      `“${BEFORE_2022}” pauses. It continues where it stopped when you sign in again.`,
    );
    await signOutDialog(second).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(signedOutHeading(second)).toBeVisible();
    await expect(signedOutHeading(dashboard)).toBeVisible();

    await continueAs(dashboard);
    await openPage(dashboard, 'Activity');
    await expect(jobCard(dashboard, BEFORE_2022).getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  test('S226-26 Remove data checked, then unchecked again: Sign out keeps the data', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await openSignOut(dashboard);
    await removeData(dashboard).check();
    await expect(signOutDialog(dashboard).getByRole('button', { name: 'Sign out and remove data' })).toBeVisible();
    await removeData(dashboard).uncheck();
    await signOutDialog(dashboard).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(dashboard.getByRole('main')).toContainText(
      `@${FIXTURE_ACCOUNT.handle}’s data is still here, ready when you sign in again.`,
    );
    await continueAs(dashboard);
    await expect(await homeCounts(dashboard)).toContainText(/Posts\s*2/);
  });
});
