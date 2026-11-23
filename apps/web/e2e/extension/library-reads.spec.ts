import { readFileSync } from 'node:fs';
import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { acceptRisks, browseProfile, jobCard, risksDialog } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';

// Three fixes to the Library, in the built extension on x.com served from synthetic fixtures (ADR-0040):
// - #440: *Export JSON* saves the list the search shows, not every item of the kind;
// - #441: a read left Ready by *Not now* on the risks is said to be ready, not under way, and can be cancelled there;
// - #442: one read per account: *Read one part* is off, with its reason, while a read hasn't ended.
// The Library's scenarios (docs/scenarios/185-library.md) come with #396; these tests join them there.

test.use({ xHistory: 'long' });

/** The fixture account's post with *launch* in it; the other four don't have the word. */
const LAUNCH_POST = '9000000000000000106';

/** What the copy card says of a read left Ready. */
const READY = 'A read from X is ready, but hasn’t started.';

/** Why *Read one part* is off while a read hasn't ended. */
const ONE_AT_A_TIME = 'One read at a time: Read one part is off until this read finishes or you cancel it.';

/** Brings the dashboard forward and opens the Library from the sidebar. */
async function openLibrary(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
}

/** A card of the Library, by its heading. */
const card = (dashboard: Page, title: 'Your copy' | 'Browse'): Locator =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { level: 2, name: title, exact: true }) });

/** The rows Browse lists, without its header row. */
const rows = (dashboard: Page): Locator => card(dashboard, 'Browse').getByRole('rowgroup').nth(1).getByRole('row');

/** Unfolds *Other ways: read from X*, the part of the copy card with the reads. */
async function unfoldReads(dashboard: Page) {
  const fold = dashboard.getByRole('button', { name: 'Other ways: read from X' });
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
}

/** *Read one part*, the menu of single reads. */
const readOnePart = (dashboard: Page): Locator => dashboard.getByRole('button', { name: 'Read one part' });

/** The jobs listed under Activity, each a card. */
const jobCards = (dashboard: Page): Locator => dashboard.getByRole('main').getByRole('group');

/** The person presses *Complete my copy* on the Library, then *Not now* on the risks: the read is left Ready. */
async function completeMyCopyNotNow(dashboard: Page) {
  await openLibrary(dashboard);
  await unfoldReads(dashboard);
  await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
  const risks = risksDialog(dashboard);
  await risks.getByRole('button', { name: 'Not now' }).click();
  await expect(risks).toBeHidden();
  await expect(jobCard(dashboard, 'Complete my copy')).toContainText('Ready');
}

/** The URLs and methods of the requests `context` sends to x.com from now on, as they go. */
function xRequests(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => {
    if (new URL(request.url()).host === 'x.com') sent.push(`${request.method()} ${request.url()}`);
  });
  return sent;
}

/** Presses *Export JSON* under Browse, and returns the name and the ids of the items in the file it saves. */
async function exportJson(dashboard: Page): Promise<{ name: string; ids: string[] }> {
  const download = dashboard.waitForEvent('download');
  await card(dashboard, 'Browse').getByRole('button', { name: 'Export JSON' }).click();
  const file = await download;
  const saved = JSON.parse(readFileSync(await file.path(), 'utf8')) as { id: string; kind: string; status: string }[];
  expect(new Set(saved.map((item) => `${item.kind} ${item.status}`))).toEqual(new Set(['post present']));
  return { name: file.suggestedFilename(), ids: saved.map((item) => item.id) };
}

test.describe('the Library’s reads and its export', () => {
  test('Export JSON saves what the search shows, and is off when the search finds nothing (#440)', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openLibrary(dashboard);
    await expect(rows(dashboard)).toHaveCount(5);
    const search = dashboard.getByRole('searchbox', { name: 'Search text or @author' });

    await search.fill('LAUNCH');
    await expect(rows(dashboard)).toHaveCount(1);
    const found = await exportJson(dashboard);
    expect(found.name).toMatch(/^xomoni-posts-present-\d{4}-\d{2}-\d{2}\.json$/);
    expect(found.ids).toEqual([LAUNCH_POST]);

    await search.fill('made-up post');
    await expect(rows(dashboard)).toHaveCount(4);
    const madeUp = await exportJson(dashboard);
    expect(madeUp.ids).toHaveLength(4);
    expect(madeUp.ids).not.toContain(LAUNCH_POST);

    await search.fill('nothing like this');
    await expect(card(dashboard, 'Browse')).toContainText('No items match your search.');
    await expect(card(dashboard, 'Browse').getByRole('button', { name: 'Export JSON' })).toBeDisabled();

    await dashboard.getByRole('button', { name: 'Clear search' }).click();
    await expect(rows(dashboard)).toHaveCount(5);
    expect((await exportJson(dashboard)).ids).toHaveLength(5);
  });

  test('after Not now, the Library says the read is ready, not under way, and cancels it (#441)', async ({
    dashboard,
    context,
  }) => {
    await openXWindow(dashboard);
    await completeMyCopyNotNow(dashboard);
    const sent = xRequests(context);

    await openLibrary(dashboard);
    const copy = card(dashboard, 'Your copy');
    await expect(copy).toContainText(READY);
    await expect(copy).not.toContainText('under way');
    await unfoldReads(dashboard);
    await expect(copy).toContainText(`${READY} ${ONE_AT_A_TIME}`);
    await expect(dashboard.getByRole('button', { name: 'See the read under way' })).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: 'Start the read' })).toBeEnabled();

    await dashboard.getByRole('button', { name: 'Cancel the read' }).click();
    await expect(dashboard.getByRole('button', { name: 'Complete my copy' })).toBeEnabled();
    await expect(readOnePart(dashboard)).toBeEnabled();
    await expect(copy).not.toContainText(READY);

    await dashboard.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(jobCards(dashboard)).toHaveCount(0);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(jobCard(dashboard, 'Complete my copy')).toContainText('Cancelled');
    expect(sent, 'requests to X').toEqual([]);
  });

  test('Read one part is off, with its reason, while a read hasn’t ended, so no second read is queued (#442)', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await completeMyCopyNotNow(dashboard);

    await openLibrary(dashboard);
    await unfoldReads(dashboard);
    const trigger = readOnePart(dashboard);
    await expect(trigger).toBeDisabled();
    await expect(trigger).toHaveAccessibleDescription(`${READY} ${ONE_AT_A_TIME}`);
    await expectNoSeriousA11yViolations(dashboard);
    // Still reached with Tab, so a screen reader says why; Enter and the arrow open nothing.
    await tabTo(trigger);
    await dashboard.keyboard.press('Enter');
    await dashboard.keyboard.press('ArrowDown');
    await expect(dashboard.getByRole('menu')).toHaveCount(0);
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(jobCards(dashboard)).toHaveCount(1);

    // Started from the Library, through the risks it was left at: under way, and still one read at a time.
    await openLibrary(dashboard);
    await unfoldReads(dashboard);
    await dashboard.getByRole('button', { name: 'Start the read' }).click();
    await acceptRisks(dashboard);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(jobCard(dashboard, 'Complete my copy')).toContainText(/Running|Waiting/);
    await expect(jobCards(dashboard)).toHaveCount(1);

    await openLibrary(dashboard);
    await expect(card(dashboard, 'Your copy')).toContainText('A read from X is under way.');
    await unfoldReads(dashboard);
    await expect(readOnePart(dashboard)).toBeDisabled();
    await expect(readOnePart(dashboard)).toHaveAccessibleDescription(`A read from X is under way. ${ONE_AT_A_TIME}`);
    await expect(dashboard.getByRole('button', { name: 'See the read under way' })).toBeVisible();
  });
});
