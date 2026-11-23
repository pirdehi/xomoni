import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  browseProfile,
  confirmDialog,
  continueWithoutArchive,
  jobCard,
  openCleanup,
  openPage,
  removeBefore,
  risksDialog,
  startButton,
  workAnyTime,
} from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT, servePage, setXSession } from '../support/x-fixtures';

// The states of the extension a page sweep never reaches (#389), each opened on purpose and checked by axe-core in
// light and dark mode: its dialogs and menus, the consent and risk dialogs, errors and refusals, empty lists, toasts,
// and a job running, paused, cancelled and stopped for safety. Every check is soft, so one run reports every state.
// `a11y.spec.ts` checks the pages themselves.

/** A check that fails the test at its end, so the states after it are still checked. */
const check = (dashboard: Page) => expectNoSeriousA11yViolations(dashboard, { soft: true });

/** The title of the cleanup these tests start: the fixture account's posts before 2021, two of them. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

/** Opens Cleanup on posts before 2021, past the warning that no archive was imported. */
async function postsBefore2021(dashboard: Page) {
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await continueWithoutArchive(dashboard);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`the extension's states, in ${colorScheme} mode (#389)`, () => {
    test.use({ colorScheme, xHistory: 'long' });
    // Many states, each settling before axe reads it.
    test.describe.configure({ timeout: 240_000 });

    test('empty lists, before Xomoni has anything of the account', async ({ dashboard }) => {
      await openXWindow(dashboard);
      await dashboard.bringToFront();
      // Home: nothing done yet, nothing counted.
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
      await expect(dashboard.getByText('Nothing yet')).toBeVisible();
      await check(dashboard);

      // Library: nothing in the copy, and nothing removed.
      await openPage(dashboard, 'Home');
      await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
      await expect(dashboard.getByText('Nothing here')).toBeVisible();
      await check(dashboard);

      // Activity: no jobs, then no log.
      await openPage(dashboard, 'Activity');
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
      await check(dashboard);
      await dashboard.getByRole('tab', { name: 'Log' }).click();
      await expect(dashboard.getByText('No activity')).toBeVisible();
      await check(dashboard);

      // Cleanup with nothing in the copy: nothing matches.
      await openCleanup(dashboard);
      await check(dashboard);
    });

    test('dialogs and menus: the account panel, signing out, reading one part, a copy', async ({ dashboard, page }) => {
      await openXWindow(dashboard);
      await browseProfile(page);
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

      // The account panel (Connections), a popover that holds the focus: opened from the keyboard, with the pointer
      // elsewhere, and with the pointer over its button. Either way the button's handle stays readable (#389).
      const sidebar = dashboard.getByRole('complementary');
      const account = sidebar.locator('button[aria-haspopup="dialog"]');
      const connections = dashboard.getByRole('dialog', { name: 'Connections' });
      await dashboard.mouse.move(600, 10);
      await account.focus();
      await dashboard.keyboard.press('Enter');
      await expect(connections).toBeVisible();
      await check(dashboard);
      await dashboard.keyboard.press('Escape');
      await expect(connections).toBeHidden();
      await account.hover();
      await check(dashboard);
      await account.click();
      await expect(connections).toBeVisible();
      await check(dashboard);

      // Signing out of Xomoni: its dialog, with what it does and the choice to remove the account's data.
      await connections.getByRole('button', { name: 'Sign out of Xomoni' }).click();
      const signOut = dashboard.getByRole('dialog', { name: 'Sign out of Xomoni?' });
      await expect(signOut).toBeVisible();
      await check(dashboard);
      await signOut.getByRole('button', { name: 'Cancel' }).click();
      await expect(signOut).toBeHidden();

      // The Library's menu of single reads, inside its fold, and *Download a copy*.
      await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
      await dashboard.getByRole('button', { name: 'Other ways: read from X' }).click();
      await dashboard.getByRole('button', { name: 'Read one part' }).click();
      await expect(dashboard.getByRole('menu')).toBeVisible();
      await check(dashboard);
      await dashboard.keyboard.press('Escape');
      await expect(dashboard.getByRole('menu')).toBeHidden();

      await dashboard.getByRole('button', { name: 'Download a copy' }).click();
      const copy = dashboard.getByRole('dialog', { name: 'Download a copy' });
      await expect(copy).toBeVisible();
      await check(dashboard);
      await dashboard.keyboard.press('Escape');
      await expect(copy).toBeHidden();

      // Delete all local data: its dialog, then the toast that says it is done.
      await openPage(dashboard, 'Settings');
      await dashboard.getByRole('button', { name: 'Delete local data' }).click();
      const wipe = dashboard.getByRole('dialog', { name: 'Delete all local data?' });
      await expect(wipe).toBeVisible();
      await check(dashboard);
      await wipe.getByRole('button', { name: 'Delete local data' }).click();
      await expect(dashboard.getByText('All local Xomoni data was deleted')).toBeVisible();
      await check(dashboard);
    });

    test(
      'S199-35 a cleanup: its confirmation, the risks, and the job running, paused and cancelled',
      { tag: ['@task-199'] },
      async ({ dashboard, page }) => {
        await openXWindow(dashboard);
        await browseProfile(page);
        await workAnyTime(dashboard);
        await postsBefore2021(dashboard);
        await expect(startButton(dashboard)).toBeEnabled();

        // The typed DELETE, then the risks Xomoni asks a person to read before an account's first job (#24).
        await startButton(dashboard).click();
        const confirm = confirmDialog(dashboard);
        await expect(confirm).toBeVisible();
        await check(dashboard);
        await confirm.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
        await check(dashboard);
        await confirm.getByRole('button', { name: 'Start cleanup' }).click();
        const risks = risksDialog(dashboard);
        await expect(risks).toBeVisible();
        await check(dashboard);
        await risks.getByRole('textbox', { name: 'Type I UNDERSTAND to continue' }).fill('I UNDERSTAND');
        await risks.getByRole('button', { name: 'I understand, continue' }).click();
        await expect(risks).toBeHidden();

        // The job runs: its banner over every page, and its card.
        await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
        const card = jobCard(dashboard, BEFORE_2021);
        await expect(card.getByRole('button', { name: 'Pause' })).toBeVisible();
        await check(dashboard);

        // Paused, with Resume and Cancel; then cancelled, with Remove.
        await card.getByRole('button', { name: 'Pause' }).click();
        await expect(card.getByRole('button', { name: 'Resume' })).toBeVisible();
        await check(dashboard);
        await card.getByRole('button', { name: 'Cancel' }).click();
        // A cancelled job has left the open jobs: all of them show it, with Remove.
        await dashboard.getByRole('button', { name: 'All', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Remove' })).toBeVisible();
        await check(dashboard);
      },
    );

    test(
      'S17-37 stopped for safety: X’s notice of a limited account, and the dialog to resume anyway',
      { tag: ['@task-17'] },
      async ({ dashboard, page, context }) => {
        await openXWindow(dashboard);
        await browseProfile(page);
        await workAnyTime(dashboard);
        await postsBefore2021(dashboard);
        await servePage(context, '/home', 'home-limited.html');
        await startButton(dashboard).click();
        await confirmDialog(dashboard).getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
        await confirmDialog(dashboard).getByRole('button', { name: 'Start cleanup' }).click();
        const risks = risksDialog(dashboard);
        await risks.getByRole('textbox', { name: 'Type I UNDERSTAND to continue' }).fill('I UNDERSTAND');
        await risks.getByRole('button', { name: 'I understand, continue' }).click();

        // The job stops at its first look at X's Home, which waits for Xomoni's pace first: 12 to 24 s on a new
        // account, and up to 90 s more one time in twenty, as cleanup-by-date.spec.ts waits for the same page.
        const card = jobCard(dashboard, BEFORE_2021);
        await expect(card.getByRole('button', { name: /^Resume in 1[12]h \d+m$/ })).toBeDisabled({ timeout: 150_000 });
        await check(dashboard);
        await card.getByRole('button', { name: 'Resume anyway…' }).click();
        const resume = dashboard.getByRole('dialog', { name: 'Risk level 3: Defensive' });
        await expect(resume).toBeVisible();
        await check(dashboard);
        await resume.getByRole('button', { name: 'Keep waiting' }).click();
        await expect(resume).toBeHidden();

        // The limits panel with the ladder's level.
        await openPage(dashboard, 'Settings');
        await dashboard.getByRole('button', { name: 'Today’s use of X’s limits' }).click();
        await expect(dashboard.getByText('Risk level 3: Defensive')).toBeVisible();
        await check(dashboard);
      },
    );

    test('errors and refusals: a file that is no move file, a ZIP that is no archive, a date that makes no sense', async ({
      dashboard,
      page,
    }) => {
      await openXWindow(dashboard);
      await browseProfile(page);
      await dashboard.bringToFront();

      // Move your data: a file that isn't Xomoni's export is refused, and nothing is imported.
      await openPage(dashboard, 'Settings');
      await expect(dashboard.getByRole('button', { name: 'Import from a file' })).toBeEnabled();
      await dashboard.getByTestId('move-file').setInputFiles({
        name: 'notes.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"hello":"world"}'),
      });
      await expect(dashboard.getByText('Not imported')).toBeVisible();
      await check(dashboard);

      // The Library: a ZIP that isn't X's archive is refused.
      await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
      await dashboard.getByRole('button', { name: 'Already have the ZIP?' }).click();
      await dashboard.getByTestId('zip-input').setInputFiles({
        name: 'twitter-archive.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from('not a zip at all'),
      });
      await expect(dashboard.getByRole('button', { name: 'Choose ZIP file' })).toBeVisible();
      await check(dashboard);

      // Cleanup: a range whose start is after its end, and an empty date.
      await openCleanup(dashboard);
      await removeBefore(dashboard, '2021-01-01');
      await dashboard.getByRole('switch', { name: 'Only within a date range' }).click();
      await dashboard.getByLabel('Start date (inclusive)').fill('2022-01-01');
      await expect(dashboard.getByText('The start date must be before the end date.')).toBeVisible();
      await check(dashboard);
      await dashboard.getByLabel('Remove everything before').fill('');
      await expect(dashboard.getByText('Pick the date to clean up before.')).toBeVisible();
      await check(dashboard);
    });

    test('X needs the person: signed out of X, and signed out of Xomoni', async ({ dashboard, context }) => {
      const x = await openXWindow(dashboard);
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

      // Signed out of X: the banner over every page, and the X window's chip.
      await setXSession(context, null);
      await x.reload();
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('status', { name: 'X needs you' })).toBeVisible();
      await check(dashboard);

      // Signed out of Xomoni: the page that offers to continue.
      await setXSession(context, FIXTURE_ACCOUNT.id);
      await x.reload();
      await dashboard.bringToFront();
      await dashboard.getByRole('complementary').locator('button[aria-haspopup="dialog"]').click();
      await dashboard.getByRole('button', { name: 'Sign out of Xomoni' }).click();
      const signOut = dashboard.getByRole('dialog', { name: 'Sign out of Xomoni?' });
      await signOut.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(signOut).toBeHidden();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'You’re signed out' })).toBeVisible();
      await check(dashboard);
      // Signing out closed the X window; opened again, it offers to continue as the account it is signed in to.
      await dashboard.getByRole('main').getByRole('button', { name: 'Open X window' }).click();
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('button', { name: /^Continue as @/ })).toBeVisible();
      await check(dashboard);
    });
  });
}
