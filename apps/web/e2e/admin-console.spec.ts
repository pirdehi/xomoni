import type { Page } from '@playwright/test';
import { createConfirmedUser, makeSuperadmin } from './support/admin';
import { PASSWORD, passwordInput, signIn, submit, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// The super-admin console at /product (#516): its own sign-in, a true 404 for everyone else (the proxy answers before
// any page renders), and the overview, users, actions and audit log for a super-admin. Accounts are seeded with the
// local stack's service-role key, as the maintainer makes a super-admin with SQL (ADR-0048).

/** The one answer for wrong details and for an account that isn't a super-admin. */
const REFUSED = 'These details don’t open the console.';

/** Signs in on the console's own sign-in page. */
async function consoleSignIn(page: Page, email: string, password: string, path = '/product/login'): Promise<void> {
  await page.goto(path);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await passwordInput(page).fill(password);
  await submit(page, 'Open the console');
}

/** The form's own message (Next.js's route announcer is an alert too, outside the page's main). */
const formAlert = (page: Page) => page.getByRole('main').getByRole('alert');

/** The console's sidebar. */
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Console' });

test('a signed-out visitor is sent to the console’s own sign-in, and back afterwards', async ({ page }) => {
  await page.goto('/product/users');
  await expect(page).toHaveURL(/\/product\/login\?next=%2Fproduct%2Fusers$/);
  await expect(page.getByRole('heading', { name: 'Xomoni console' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the console' })).toBeVisible();
  // Email and password only: no Google, no sign-up.
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Create an account/ })).toHaveCount(0);

  await page.goto('/product');
  await expect(page).toHaveURL(/\/product\/login\?next=%2Fproduct$/);
});

test('an ordinary account is refused at the console’s sign-in exactly like a wrong password, and signed out', async ({
  page,
}) => {
  const email = uniqueEmail('console-stranger');
  await createConfirmedUser(email, PASSWORD);

  await consoleSignIn(page, email, 'not the password 1');
  await expect(formAlert(page)).toHaveText(REFUSED);

  await consoleSignIn(page, email, PASSWORD);
  await expect(formAlert(page)).toHaveText(REFUSED);
  await expect(page).toHaveURL(/\/product\/login$/);

  // The session the right password opened was ended at once.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test('an ordinary account signed in normally gets the site’s 404, with a 404 status, at every console page', async ({
  page,
}) => {
  const email = uniqueEmail('console-ordinary');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);

  for (const path of ['/product', '/product/users', '/product/documents', '/product/audit', '/product/roadmap']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByText('This page could not be found.'), path).toBeVisible();
    await expect(page.getByText('Xomoni console'), path).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Console' }), path).toHaveCount(0);
  }

  // The document route answers its own 404.
  const document = await page.goto('/product/document');
  expect(document?.status()).toBe(404);

  // The console's sign-in stays open to them, signed in or not.
  await page.goto('/product/login');
  await expect(page.getByRole('button', { name: 'Open the console' })).toBeVisible();
});

test('a super-admin runs the console: overview, a user found and signed out, suspended, restored, another deleted, all in the audit log', async ({
  page,
  browser,
}) => {
  test.slow();
  const adminEmail = uniqueEmail('console-admin');
  await makeSuperadmin(await createConfirmedUser(adminEmail, PASSWORD));
  const graceEmail = uniqueEmail('console-grace');
  const graceId = await createConfirmedUser(graceEmail, PASSWORD);
  const goneEmail = uniqueEmail('console-gone');
  const goneId = await createConfirmedUser(goneEmail, PASSWORD);

  // Grace is signed in elsewhere.
  const elsewhere = await browser.newContext();
  const gracePage = await elsewhere.newPage();
  await signIn(gracePage, graceEmail, PASSWORD);
  await expect(gracePage).toHaveURL(/\/dashboard$/);

  await consoleSignIn(page, adminEmail, PASSWORD, '/product/login?next=%2Fproduct');
  await expect(page).toHaveURL(/\/product$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Browsers connected' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sign-ups per day' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(adminEmail);

  // Already signed in, the console's sign-in goes straight on.
  await page.goto('/product/login');
  await expect(page).toHaveURL(/\/product$/);

  // Users: search, then open the account.
  await sidebar(page).getByRole('link', { name: 'Users' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/product/users');
  await page.getByRole('searchbox', { name: 'Search by email' }).fill(graceEmail);
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === graceEmail);
  const row = page.getByRole('row', { name: graceEmail });
  await expect(row).toHaveCount(1);
  await row.getByRole('link', { name: graceEmail }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/product/users/${graceId}`);
  await expect(page.getByRole('heading', { level: 1, name: graceEmail })).toBeVisible();

  // Sign out everywhere: Grace's other browser loses its session.
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.getByText(/^Signed out everywhere: \d+ sessions? ended\.$/)).toBeVisible();
  await gracePage.goto('/dashboard');
  await expect(gracePage).toHaveURL(/\/login\?next=%2Fdashboard$/);

  // Suspend: she can't sign in; restore: she can again.
  await page.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByText('Suspended: the account can’t sign in.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await signIn(gracePage, graceEmail, PASSWORD);
  await expect(gracePage.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(gracePage).toHaveURL(/\/login/);

  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored: the account can sign in again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
  await signIn(gracePage, graceEmail, PASSWORD);
  await expect(gracePage).toHaveURL(/\/dashboard$/);
  await elsewhere.close();

  // Delete another account, typing its email in the dialog.
  await page.goto(`/product/users/${goneId}`);
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this account?' });
  const confirm = dialog.getByRole('button', { name: 'Delete account' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the account’s email to confirm').fill(goneEmail);
  await confirm.click();
  await expect(page).toHaveURL((url) => url.pathname === '/product/users');
  await page.getByRole('searchbox', { name: 'Search by email' }).fill(goneEmail);
  await expect(page.getByText(`No account matches “${goneEmail}”.`)).toBeVisible();

  // Every action is in the audit log, newest first.
  await sidebar(page).getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/product/audit');
  const log = page.getByRole('region', { name: 'Audit log' });
  const graceLines = log.getByRole('row').filter({ hasText: graceEmail });
  await expect(graceLines).toHaveCount(3);
  await expect(graceLines.nth(0)).toContainText('Restored the account');
  await expect(graceLines.nth(1)).toContainText('Suspended the account');
  await expect(graceLines.nth(2)).toContainText('Signed out everywhere');
  await expect(graceLines.first()).toContainText(adminEmail);
  // A deleted account is remembered by its email's domain only.
  await expect(
    log.getByRole('row').filter({ hasText: adminEmail }).filter({ hasText: 'Deleted the account' }),
  ).toContainText('An account at xomoni.test');

  // The product document is still served on its own, sandboxed, at /product/document.
  await expect(sidebar(page).getByRole('link', { name: /Product document/ })).toHaveAttribute('target', '_blank');
  const response = await page.goto('/product/document');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain('sandbox allow-scripts allow-popups');
  expect(headers['content-security-policy']).not.toContain('allow-same-origin');
});
