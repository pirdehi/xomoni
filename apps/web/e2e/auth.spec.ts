import type { Page } from '@playwright/test';
import { emailsTo, waitForEmail } from './support/mailpit';
import { canRenew, refreshTokenOf } from './support/session';
import { expect, test } from './support/test';
import {
  NEW_PASSWORD,
  PASSWORD,
  expectDashboard,
  followEmailLink,
  passwordInput,
  signIn,
  signOut,
  signUp,
  signUpConfirmed,
  submit,
  uniqueEmail,
} from './support/flows';

const NO_MATCH = 'That email and password don’t match an account.';

/** Turnstile's API, faked: every widget asks for a click and stays without a token. */
const INTERACTIVE_TURNSTILE = `
  window.turnstile = {
    render(el, options) {
      setTimeout(() => options['before-interactive-callback']?.(), 0);
      return 'interactive-widget';
    },
    reset() {},
    remove() {},
    execute() {},
    getResponse() {},
    isExpired() { return false; },
  };
  const onload = new URL(document.currentScript.src).searchParams.get('onload');
  if (onload) window[onload]();
`;

/** The form's error message (Next.js also renders a route announcer with role="alert"). */
const formAlert = (page: Page) => page.getByRole('main').getByRole('alert');

test.describe('sign-up and email confirmation', () => {
  test('creates an account, confirms it by email and opens the dashboard', async ({ page }) => {
    const email = uniqueEmail('signup');
    await signUp(page, email);
    await expect(page.getByText(email)).toBeVisible();

    const message = await waitForEmail(email, 'Confirm your Xomoni account');
    expect(message.html).toContain('Confirm email address');

    await followEmailLink(page, email, 'Confirm your Xomoni account');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Test Person' })).toBeVisible();
    await expect(page.getByText(email).first()).toBeVisible();
  });

  test('shows the password rules and rejects weak passwords before sending anything', async ({ page }) => {
    const email = uniqueEmail('weak');
    await page.goto('/signup');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await passwordInput(page).fill('lettersonly');
    await expect(page.getByRole('listitem').filter({ hasText: 'At least one number' })).toContainText('(not met yet)');
    await submit(page, 'Create account');
    await expect(page.getByText('Password needs: at least one number (0–9)')).toBeVisible();

    await passwordInput(page).fill('letters and 1 number');
    await expect(page.getByRole('listitem').filter({ hasText: 'At least one number' })).toContainText('(met)');
    expect(await emailsTo(email, 'Confirm your Xomoni account')).toHaveLength(0);
  });

  test('answers the same way for an address that already has an account', async ({ page }) => {
    const email = uniqueEmail('exists');
    await signUpConfirmed(page, email);
    await signOut(page);

    await signUp(page, email, 'another password 3');
    await expect(page.getByText(`We sent a confirmation link to ${email}`)).toBeVisible();
    // No second email: Supabase stays silent for confirmed accounts, so the owner isn't spammed.
    await page.waitForTimeout(3000);
    expect(await emailsTo(email, 'Confirm your Xomoni account')).toHaveLength(1);
  });

  test('asks unconfirmed accounts to confirm first and resends the link', async ({ page }) => {
    const email = uniqueEmail('unconfirmed');
    await signUp(page, email);
    await waitForEmail(email, 'Confirm your Xomoni account');

    await signIn(page, email, PASSWORD);
    await expect(page.getByText('Confirm your email address first.')).toBeVisible();

    await page.waitForTimeout(6000); // local max_frequency between confirmation emails is 5 s
    await submit(page, 'Send the confirmation link again');
    await expect(page.getByText(`We sent a new confirmation link to ${email}.`)).toBeVisible();
    await waitForEmail(email, 'Confirm your Xomoni account', 2);

    await followEmailLink(page, email, 'Confirm your Xomoni account', 2);
    await expectDashboard(page);
  });
});

test.describe('sign-in', () => {
  test('gives the same answer for a wrong password and an unknown account', async ({ page }) => {
    const email = uniqueEmail('signin');
    await signUpConfirmed(page, email);
    await signOut(page);

    await signIn(page, email, 'not the password 9');
    await expect(formAlert(page)).toHaveText(NO_MATCH);

    await signIn(page, uniqueEmail('nobody'), PASSWORD);
    await expect(formAlert(page)).toHaveText(NO_MATCH);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
  });

  test('guards private pages and returns to them after sign-in, never off-site', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);

    const email = uniqueEmail('guard');
    await signUpConfirmed(page, email);
    await signOut(page);

    await page.goto('/account');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await passwordInput(page).fill(PASSWORD);
    await submit(page, 'Sign in');
    await expect(page).toHaveURL(/\/account$/);

    // Signed in: the guest-only pages send you to the dashboard.
    for (const path of ['/login', '/signup', '/forgot-password']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard$/);
    }

    await signOut(page);
    await signIn(page, email, PASSWORD, '/login?next=https%3A%2F%2Fevil.example%2F');
    await expect(page).toHaveURL('http://localhost:3000/dashboard');
  });

  test('offers a retry when the security check cannot load', async ({ page }) => {
    // Simulates a network that can't reach Cloudflare: the form must say so instead of waiting forever.
    await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
    await page.goto('/forgot-password');
    await expect(page.getByText('The security check didn’t finish.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeDisabled();

    await page.unroute('https://challenges.cloudflare.com/**');
    await page.getByRole('button', { name: 'try again' }).click();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeEnabled({ timeout: 30_000 });
  });

  test('asks for a click when Cloudflare wants one, instead of blaming the connection', async ({ page }) => {
    // A stand-in for Turnstile that asks the person to tick its box and never produces a token on its own.
    await page.clock.install();
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: INTERACTIVE_TURNSTILE }),
    );
    await page.goto('/login');
    await expect(page.getByText('Tick the box above to continue.')).toBeVisible();

    // Well past the 20 s after which a silent check counts as stalled.
    await page.clock.fastForward(60_000);
    await expect(page.getByText('Tick the box above to continue.')).toBeVisible();
    await expect(page.getByText('The security check didn’t finish.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  });

  test('starts Google sign-in at Google', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await page.waitForURL(/accounts\.google\.com/);
  });
});

test.describe('forgotten password', () => {
  test('resets the password from an emailed link, once', async ({ page }) => {
    const email = uniqueEmail('reset');
    await signUpConfirmed(page, email);
    await signOut(page);

    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await submit(page, 'Send reset link');
    await expect(page.getByText(`If ${email} has a Xomoni account`)).toBeVisible();

    const link = await followEmailLink(page, email, 'Reset your Xomoni password');
    await expect(page).toHaveURL(/\/reset-password$/);

    await passwordInput(page, 'New password').fill('short');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('Password needs: at least 10 characters')).toBeVisible();

    await passwordInput(page, 'New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/account\?password=updated$/);
    await expect(page.getByText('Your new password is saved.')).toBeVisible();
    await waitForEmail(email, 'Your Xomoni password was changed');

    await signOut(page);
    await signIn(page, email, PASSWORD);
    await expect(formAlert(page)).toHaveText(NO_MATCH);
    await signIn(page, email, NEW_PASSWORD);
    await expectDashboard(page);

    // The same link can't be used twice.
    await signOut(page);
    await page.goto(link);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('That link is invalid, already used or expired.')).toBeVisible();
  });

  test('looks the same for an unknown address and sends nothing', async ({ page }) => {
    const email = uniqueEmail('ghost');
    await page.goto('/forgot-password');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await submit(page, 'Send reset link');
    await expect(page.getByText(`If ${email} has a Xomoni account`)).toBeVisible();
    await page.waitForTimeout(2000);
    expect(await emailsTo(email, 'Reset your Xomoni password')).toHaveLength(0);
  });

  test('rejects tampered links before they reach Supabase', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=abc&type=recovery');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('That link is invalid, already used or expired.')).toBeVisible();
  });
});

test.describe('account page', () => {
  test('changes the password only with the current one', async ({ page }) => {
    const email = uniqueEmail('change-pw');
    await signUpConfirmed(page, email);
    await page.goto('/account');

    await passwordInput(page, 'Current password').fill('wrong password 0');
    await passwordInput(page, 'New password').fill(NEW_PASSWORD);
    await submit(page, 'Change password');
    await expect(page.getByText('Your current password is incorrect.')).toBeVisible();

    await passwordInput(page, 'Current password').fill(PASSWORD);
    await passwordInput(page, 'New password').fill(NEW_PASSWORD);
    await submit(page, 'Change password');
    await expect(page.getByText('Your new password is saved.')).toBeVisible();
    await waitForEmail(email, 'Your Xomoni password was changed');

    await signOut(page);
    await signIn(page, email, NEW_PASSWORD);
    await expectDashboard(page);
  });

  test('runs the captcha on the account page after an in-app navigation', async ({ page }) => {
    // Regression: arriving at /account by client-side navigation (sign-in with ?next=/account) left the
    // captcha without a token in production, so "Change password" never enabled.
    const email = uniqueEmail('nav-captcha');
    await signUpConfirmed(page, email);
    await signOut(page);
    await page.goto('/account');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await passwordInput(page).fill(PASSWORD);
    await submit(page, 'Sign in');
    await expect(page).toHaveURL(/\/account$/);
    await passwordInput(page, 'Current password').fill(PASSWORD);
    await passwordInput(page, 'New password').fill(NEW_PASSWORD);
    await submit(page, 'Change password');
    await expect(page.getByText('Your new password is saved.')).toBeVisible();
  });

  test('changes the sign-in email after both addresses confirm', async ({ page }) => {
    const oldEmail = uniqueEmail('old');
    const newEmail = uniqueEmail('new');
    await signUpConfirmed(page, oldEmail);
    await page.goto('/account');

    await page.getByRole('textbox', { name: 'New email', exact: true }).fill(newEmail);
    await page.getByRole('button', { name: 'Change email' }).click();
    await expect(page.getByText(`Waiting for confirmation: ${oldEmail} → ${newEmail}`)).toBeVisible();

    await followEmailLink(page, oldEmail, 'Confirm your new Xomoni email');
    await expect(page).toHaveURL(/\/account\?email=confirmed$/);
    await followEmailLink(page, newEmail, 'Confirm your new Xomoni email');
    await expect(page).toHaveURL(/\/account\?email=confirmed$/);
    await expect(page.getByText(`Signed in as ${newEmail}`)).toBeVisible();

    await signOut(page);
    await signIn(page, newEmail, PASSWORD);
    await expectDashboard(page);
  });

  test('"Sign in again" signs out and returns to the account page, never off-site (#80)', async ({ page }) => {
    const email = uniqueEmail('again');
    await signUpConfirmed(page, email);

    // The form the delete section shows when the last sign-in is too old.
    const again = await page.request.post(`/auth/signout?next=${encodeURIComponent('/login?next=/account')}`, {
      maxRedirects: 0,
    });
    expect(again.status()).toBe(303);
    expect(again.headers()['location']).toBe('http://localhost:3000/login?next=/account');
    await signIn(page, email, PASSWORD, '/login?next=/account');
    await expect(page).toHaveURL('http://localhost:3000/account');

    const offSite = await page.request.post(`/auth/signout?next=${encodeURIComponent('https://evil.example/')}`, {
      maxRedirects: 0,
    });
    expect(offSite.headers()['location']).toBe('http://localhost:3000/');
  });

  test('signs out everywhere: other browsers can no longer renew their session (#83)', async ({ page, browser }) => {
    const email = uniqueEmail('everywhere');
    await signUpConfirmed(page, email);
    const elsewhere = await browser.newContext();
    const otherPage = await elsewhere.newPage();
    await signIn(otherPage, email, PASSWORD);
    await expectDashboard(otherPage);
    const otherSession = await refreshTokenOf(elsewhere);

    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page).toHaveURL('http://localhost:3000/');
    expect(await canRenew(otherSession)).toBe(false);
    await elsewhere.close();
  });

  test('a normal sign-out leaves the other browsers signed in', async ({ page, browser }) => {
    const email = uniqueEmail('here-only');
    await signUpConfirmed(page, email);
    const elsewhere = await browser.newContext();
    const otherPage = await elsewhere.newPage();
    await signIn(otherPage, email, PASSWORD);
    await expectDashboard(otherPage);
    const otherSession = await refreshTokenOf(elsewhere);

    await signOut(page);
    expect(await canRenew(otherSession)).toBe(true);
    await elsewhere.close();
  });

  test('deletes the account and its sign-in', async ({ page }) => {
    const email = uniqueEmail('delete');
    await signUpConfirmed(page, email);
    await page.goto('/account');

    page.once('dialog', (dialog) => dialog.accept('DELETE'));
    await page.getByRole('button', { name: 'Delete my Xomoni account' }).click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);

    await signIn(page, email, PASSWORD);
    await expect(formAlert(page)).toHaveText(NO_MATCH);
  });
});
