import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect } from './extension';
import { FIXTURE_ACCOUNT } from './x-fixtures';

// A cleanup as a person goes through it in the dashboard (#345): browsing their X profile, so Xomoni has a copy of
// it, the Cleanup page, its confirmation and the risks dialog, and the job's card under Activity. Each helper presses
// what a person presses and reads what they see; none reaches into Xomoni's code (ADR-0040).

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
