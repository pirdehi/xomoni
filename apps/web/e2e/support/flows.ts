import { expect, type Page } from '@playwright/test';
import { confirmLink, waitForEmail } from './mailpit';

/** A password that meets the policy. */
export const PASSWORD = 'first password 1';
/** A second password that meets the policy. */
export const NEW_PASSWORD = 'second password 2';

/** A fresh address per test, so tests never share an account or an inbox. */
export function uniqueEmail(label: string): string {
  // A random suffix from the platform's secure generator: CodeQL rightly flags Math.random near credentials.
  return `e2e-${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@xomoni.test`;
}

/**
 * The visible password input (not the "Show password" toggle). Next.js keeps the previous page hidden in
 * the DOM after client navigation, so hidden matches are filtered out.
 */
export const passwordInput = (page: Page, label = 'Password') =>
  page.getByLabel(label, { exact: true }).filter({ visible: true });

/** Clicks a submit button once the Turnstile check has produced a token and enabled it. */
export async function submit(page: Page, name: string | RegExp): Promise<void> {
  const button = page.getByRole('button', { name, exact: typeof name === 'string' });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
}

/** Fills the sign-up form and waits for the "check your inbox" screen. */
export async function signUp(
  page: Page,
  email: string,
  password = PASSWORD,
  name = 'Test Person',
  path = '/signup',
): Promise<void> {
  await page.goto(path);
  await page.getByRole('textbox', { name: 'Name (optional)', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await passwordInput(page).fill(password);
  await submit(page, 'Create account');
  await expect(page.getByText('Check your inbox')).toBeVisible();
}

/** Opens the newest emailed link with this subject and confirms it on the /auth/confirm page. */
export async function followEmailLink(page: Page, email: string, subject: string, count = 1): Promise<string> {
  const message = await waitForEmail(email, subject, count);
  const link = confirmLink(message.html);
  await page.goto(link);
  await page.getByRole('button', { name: /^(Confirm and continue|Continue|Confirm)$/ }).click();
  return link;
}

/** Signs up and confirms the email; ends on the dashboard, signed in. */
export async function signUpConfirmed(page: Page, email: string, password = PASSWORD): Promise<void> {
  await signUp(page, email, password);
  await followEmailLink(page, email, 'Confirm your Xomoni account');
  await expectDashboard(page);
}

/** Waits until the dashboard has rendered for a signed-in person (not just until the URL changed). */
export async function expectDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dashboard$/);
  // The header's account corner names whoever is signed in (#180).
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
  await expect(page.getByText(/Live|Connecting…/)).toBeVisible();
}

/** Submits the sign-in form. */
export async function signIn(page: Page, email: string, password: string, path = '/login'): Promise<void> {
  await page.goto(path);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await passwordInput(page).fill(password);
  await submit(page, 'Sign in');
}

/** Signs out from the account page and waits for the home page. */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
