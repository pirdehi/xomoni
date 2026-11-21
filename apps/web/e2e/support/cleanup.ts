import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test } from './extension';
import { FIXTURE_ACCOUNT } from './x-fixtures';

// A cleanup as a person goes through it in the dashboard (#345): browsing their X profile, so Xomoni has a copy of
// it, the Cleanup page, its confirmation and the risks dialog, and the job's card under Activity. Each helper presses
// what a person presses and reads what they see; none reaches into Xomoni's code (ADR-0040).

/**
 * How long a new job may take before it loads its first page of X. That load waits for Xomoni's pace: Careful's 3–6 s
 * between page loads, slower by up to four times during the warm-up, so up to 24 s, plus the longer pause Xomoni adds
 * to about one delay in twenty, up to 90 s (`LONG_PAUSE` in apps/extension/src/shared/pacing.ts). The extension's
 * timers run in a worker Playwright's clock can't speed up (ADR-0040), so a test that waits for that first page waits
 * this long, not the 10 s an assertion gets by default (#373).
 */
export const FIRST_PAGE_LOAD_MS = 150_000;

/** Gives the running test room, beyond its own timeout, to wait `FIRST_PAGE_LOAD_MS` for a new job's first page. */
export function allowFirstPageLoad(): void {
  test.setTimeout(test.info().timeout + FIRST_PAGE_LOAD_MS);
}

/** The tabs of the fixture account's profile, with X's path for each. */
const PROFILE_TABS = { posts: '', replies: '/with_replies', likes: '/likes' } as const;

/** A tab of the fixture account's profile on X. */
export type ProfileTab = keyof typeof PROFILE_TABS;

/**
 * Opens the fixture account's profile tabs in `page`, the person's own tab, as they browse X: X's answers fill
 * Xomoni's copy of the account. Waits until each tab shows what X answered.
 */
export async function browseProfile(page: Page, tabs: readonly ProfileTab[] = ['posts', 'replies', 'likes']) {
  for (const tab of tabs) {
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}${PROFILE_TABS[tab]}`);
    await expect(page.getByRole('article').first()).toBeVisible();
  }
}

/** Brings the dashboard forward and opens `item` from the sidebar's menu, such as Cleanup or Activity. */
export async function openPage(dashboard: Page, item: 'Home' | 'Cleanup' | 'Activity' | 'Settings') {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: item, exact: true }).click();
}

/** Opens Cleanup from the sidebar, once Xomoni knows the X account. */
export async function openCleanup(dashboard: Page) {
  await openPage(dashboard, 'Cleanup');
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
}

/** One of the four things a cleanup removes, as its card on Cleanup names it. */
export type TargetName = 'Posts' | 'Replies' | 'Reposts' | 'Likes';

/** The card for `name` under *1 · What to clean up*: a toggle button, pressed while chosen, with its count. */
export const targetCard = (dashboard: Page, name: TargetName): Locator =>
  dashboard.getByRole('button', { name: new RegExp(`^${name} [\\d,]+ in your copy$`) });

/** Cleanup's *Review* card: what matches in the copy, the pace, and the buttons that back up and start. */
export const reviewCard = (dashboard: Page): Locator =>
  dashboard
    .locator('section')
    .filter({ has: dashboard.getByRole('heading', { level: 2, name: 'Review', exact: true }) });

/** The number of matching items the Review card shows, once it shows one. */
export async function matching(dashboard: Page): Promise<number> {
  const count = reviewCard(dashboard).getByText(/^[\d,]+$/);
  await expect(count).toBeVisible();
  return Number((await count.innerText()).replace(/,/g, ''));
}

/** The items the Review card previews, as `<date> <text>` lines, newest first. */
export const previewed = (dashboard: Page): Locator => reviewCard(dashboard).getByRole('listitem');

/** Chooses *Pick a date* under *2 · Older than* and types `date` (`YYYY-MM-DD`) in *Remove everything before*. */
export async function removeBefore(dashboard: Page, date: string) {
  await dashboard.getByRole('button', { name: 'Pick a date', exact: true }).click();
  await dashboard.getByLabel('Remove everything before').fill(date);
}

/**
 * Cleanup's keep rules, under *Exceptions* (#367): the button that unfolds and folds them, the one line that says
 * what they keep while they are folded, and the rules themselves, which show only while unfolded. The likes field
 * shows for posts and replies only, and the switch for replies only.
 */
export function keepRules(dashboard: Page) {
  const card = dashboard
    .locator('section')
    .filter({ has: dashboard.getByRole('heading', { level: 2, name: /· Exceptions$/ }) });
  return {
    /** *Choose what to keep*, a button that says whether the rules are unfolded (`aria-expanded`). */
    toggle: card.getByRole('button', { name: 'Choose what to keep' }),
    /** What the rules keep, in one line, such as *Keeps posts with 50+ likes.*: shown while they are folded. */
    summary: card.getByText(/^(Keeps .+\.|Nothing is kept: everything that matches is removed\.)$/),
    /** *Keep if it has at least … likes*: digits only. */
    minLikes: card.getByRole('textbox', { name: 'Keep if it has at least … likes' }),
    /** *Keep if the text contains*: words or phrases, separated by commas or new lines. */
    keywords: card.getByRole('textbox', { name: 'Keep if the text contains' }),
    /** *Always keep these posts*: post links or ids. */
    links: card.getByRole('textbox', { name: 'Always keep these posts' }),
    /** *Keep replies in my own threads*, on unless the person turns it off. */
    ownThreads: card.getByRole('switch', { name: 'Keep replies in my own threads' }),
  };
}

/** The switch under the warning that a cleanup without the X archive can miss old posts (PLAYBOOK E2). */
export const continueWithoutIt = (dashboard: Page): Locator =>
  dashboard.getByRole('switch', { name: 'Continue without it: I understand old posts may be missed' });

/** Turns on *Continue without it*: without an archive, Start stays off until the person does. */
export async function continueWithoutArchive(dashboard: Page) {
  await continueWithoutIt(dashboard).click();
  await expect(continueWithoutIt(dashboard)).toBeChecked();
}

/** Review's *Start cleanup*, which opens the confirmation. */
export const startButton = (dashboard: Page): Locator =>
  reviewCard(dashboard).getByRole('button', { name: 'Start cleanup' });

/** The confirmation Cleanup asks for before anything acts on X: *Start this cleanup?* */
export const confirmDialog = (dashboard: Page): Locator =>
  dashboard.getByRole('dialog', { name: 'Start this cleanup?' });

/** Presses Review's *Start cleanup*, types DELETE in the confirmation, and presses its *Start cleanup*. */
export async function confirmCleanup(dashboard: Page) {
  await startButton(dashboard).click();
  const dialog = confirmDialog(dashboard);
  await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
  await dialog.getByRole('button', { name: 'Start cleanup' }).click();
  await expect(dialog).toBeHidden();
}

/** The dialog with the risks Xomoni asks a person to read before an X account's first job (#24, PLAYBOOK C7). */
export const risksDialog = (dashboard: Page): Locator =>
  dashboard
    .getByRole('dialog')
    .filter({ has: dashboard.getByRole('textbox', { name: 'Type I UNDERSTAND to continue' }) });

/** Types I UNDERSTAND in the risks dialog and presses *I understand, continue*. */
export async function acceptRisks(dashboard: Page) {
  const dialog = risksDialog(dashboard);
  await dialog.getByRole('textbox', { name: 'Type I UNDERSTAND to continue' }).fill('I UNDERSTAND');
  await dialog.getByRole('button', { name: 'I understand, continue' }).click();
  await expect(dialog).toBeHidden();
}

/** Confirms the cleanup on Cleanup with DELETE, then accepts the risks, as before an account's first job. */
export async function startCleanup(dashboard: Page) {
  await confirmCleanup(dashboard);
  await acceptRisks(dashboard);
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
}

/**
 * Turns off *Only work during active hours* in Settings, so a job may run whenever the test does: with them on
 * (8:00–23:00 by default), a job started at night first waits for the morning.
 */
export async function workAnyTime(dashboard: Page) {
  await openPage(dashboard, 'Settings');
  const hours = dashboard.getByRole('switch', { name: 'Only work during active hours' });
  await expect(hours).toBeChecked();
  // The switch shows the stored settings, so it turns off once they are saved.
  await hours.click();
  await expect(hours).not.toBeChecked();
}

/** The card of the job titled `title` under Activity › Jobs: its state, counts, live status and controls. */
export const jobCard = (dashboard: Page, title: string): Locator =>
  dashboard
    .getByRole('main')
    .getByRole('group')
    .filter({ has: dashboard.getByText(title, { exact: true }) });

/** The banner at the top of every page while a job waits for the person: what X, or Xomoni, needs to continue. */
export const attentionBanner = (dashboard: Page): Locator =>
  dashboard.getByRole('alert').filter({ hasText: /needs? (you|its X window on screen) to continue “/ });

/**
 * The seconds left in the wait a job card shows after `message`, such as `Pacing` then `6m 41s`; null while the card
 * shows no such wait.
 */
export async function waitLeft(card: Locator, message: string): Promise<number | null> {
  const text = await card.innerText();
  const escaped = message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const countdown = new RegExp(`${escaped}\\s+((?:\\d+[dhms] ?)+)`).exec(text)?.[1];
  return countdown == null ? null : seconds(countdown);
}

/** Seconds in a countdown the dashboard shows, such as `6m 41s`, `1h 2m` or `45s`. */
export function seconds(countdown: string): number {
  const part = (unit: string) => Number(new RegExp(`(\\d+)${unit}`).exec(countdown)?.[1] ?? 0);
  return part('d') * 86_400 + part('h') * 3600 + part('m') * 60 + part('s');
}

/**
 * The X window Xomoni opened, once it is open: the x.com page that isn't `ownTab`, the person's own tab. Fails when no
 * such window opens within `timeout` ms.
 */
export async function xWindowOf(context: BrowserContext, ownTab: Page | null, timeout = 15_000): Promise<Page> {
  const isXWindow = (p: Page) => p !== ownTab && p.url().startsWith('https://x.com/');
  await expect
    .poll(() => context.pages().some(isXWindow), { message: 'Xomoni opens the X window', timeout })
    .toBe(true);
  return context.pages().find(isXWindow)!;
}
