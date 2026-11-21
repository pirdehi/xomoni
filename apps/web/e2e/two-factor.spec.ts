import type { Page } from '@playwright/test';
import { addDevice, createConfirmedUser } from './support/admin';
import {
  NEW_PASSWORD,
  PASSWORD,
  followEmailLink,
  expectDashboard,
  passwordInput,
  signIn,
  signOut,
  submit,
  uniqueEmail,
} from './support/flows';
import { emailsTo, waitForEmail } from './support/mailpit';
import { expect, test } from './support/test';
import { msUntilNextStep, totp } from './support/totp';
import { aalOf, apiEnroll, apiSignIn } from './support/two-factor';

// Two-step verification on xomoni.com (#173, ADR-0036), against the local stack's real Supabase Auth: TOTP codes are
// made in the test from the secret the page shows, as an authenticator app would.

const section = (page: Page) => page.getByRole('region', { name: 'Two-step verification' });
/** The form's message (Next.js also renders a route announcer with role="alert"). */
const formAlert = (page: Page) => page.getByRole('main').getByRole('alert');

/** A confirmed account, signed in on this page; returns its email and id. */
async function signedIn(page: Page, label: string): Promise<{ email: string; userId: string }> {
  const email = uniqueEmail(label);
  const userId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  return { email, userId };
}

/** Turns two-step verification on from the account page; returns the secret the page showed. */
async function turnOn(page: Page): Promise<string> {
  await page.goto('/account');
  await section(page).getByRole('button', { name: 'Turn on two-step verification' }).click();
  await section(page).getByRole('button', { name: 'Continue' }).click();
  await expect(section(page).getByRole('img', { name: /QR code/ })).toBeVisible();
  const secret = (await section(page).getByTestId('totp-secret').innerText()).replace(/\s+/g, '');
  await section(page).getByLabel('6-digit code').fill(totp(secret));
  await section(page).getByRole('button', { name: 'Turn on' }).click();
  await expect(section(page).getByRole('status')).toContainText('Two-step verification is on.');
  return secret;
}

/** The code page, with the code typed and sent. */
async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

test.describe('two-step verification', () => {
  test('turns on with a QR code and its first code, then sign-in asks for a code before the dashboard', async ({
    page,
  }) => {
    const { email } = await signedIn(page, 'totp-enroll');

    const secret = await turnOn(page);

    await expect(section(page).getByRole('list', { name: 'Your authenticator apps' })).toContainText(
      'Authenticator app',
    );
    // The key is shown once: gone after the first code.
    await expect(section(page).getByTestId('totp-secret')).toHaveCount(0);
    const notice = await waitForEmail(email, 'An authenticator app was added to your Xomoni account');
    expect(notice.html).toContain('Authenticator app added');

    await signOut(page);
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/login\/two-factor$/);
    await expect(page.getByText(`Signing in as ${email}.`)).toBeVisible();

    await enterCode(page, '000000');
    await expect(formAlert(page)).toContainText('That code didn’t work');
    await expect(page).toHaveURL(/\/login\/two-factor$/);

    await enterCode(page, totp(secret));
    await expectDashboard(page);
  });

  test('a session with the password alone reaches no private page, and the server sends it to the code page', async ({
    page,
  }) => {
    const email = uniqueEmail('totp-aal1');
    await createConfirmedUser(email, PASSWORD);
    await apiEnroll(await apiSignIn(email, PASSWORD));

    // Signing in with the password lands on the code page, even when asked for another page.
    await signIn(page, email, PASSWORD, `/login?next=${encodeURIComponent('/account')}`);
    await expect(page).toHaveURL(/\/login\/two-factor\?next=%2Faccount$/);

    for (const [path, expected] of [
      ['/dashboard', /\/login\/two-factor$/],
      ['/dashboard/reports', /\/login\/two-factor\?next=%2Fdashboard%2Freports$/],
      ['/account', /\/login\/two-factor\?next=%2Faccount$/],
      ['/reset-password', /\/login\/two-factor\?next=%2Freset-password$/],
      ['/login', /\/login\/two-factor$/],
    ] as const) {
      const response = await page.goto(path);
      await expect(page, path).toHaveURL(expected);
      expect(response?.status(), path).toBe(200);
    }
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toHaveCount(0);
  });

  test('the database and Supabase Auth refuse an aal1 session of an account with an app', async () => {
    const email = uniqueEmail('totp-api');
    const userId = await createConfirmedUser(email, PASSWORD);
    await addDevice(userId, 'Chrome on macOS');
    const owner = await apiSignIn(email, PASSWORD);
    const { factorId, secret } = await apiEnroll(owner);

    // Someone with the password, calling the API directly.
    const thief = await apiSignIn(email, PASSWORD);
    expect(await aalOf(thief)).toBe('aal1');

    const devices = await thief.from('devices').select('id');
    expect(devices.error).toBeNull();
    expect(devices.data, 'Row Level Security hides the devices below aal2').toEqual([]);
    const code = await thief.rpc('create_pairing_code');
    expect(code.error?.hint).toBe('second_factor_required');
    const deletion = await thief.rpc('delete_account');
    expect(deletion.error?.hint).toBe('second_factor_required');

    const removal = await thief.auth.mfa.unenroll({ factorId });
    expect(removal.error?.code, 'removing an app needs aal2').toBe('insufficient_aal');
    const another = await thief.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Thief' });
    expect(another.error?.code, 'adding a second app needs aal2').toBe('insufficient_aal');
    const password = await thief.auth.updateUser({ password: 'stolen password 9', current_password: PASSWORD });
    expect(password.error?.code, 'changing the password needs aal2').toBe('insufficient_aal');

    // The owner, with a code from the app, reads the account as before.
    const verified = await owner.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
    expect(verified.error).toBeNull();
    expect(await aalOf(owner)).toBe('aal2');
    expect((await owner.from('devices').select('name')).data).toEqual([{ name: 'Chrome on macOS' }]);
  });

  test('a challenge works once: replaying it with its code is refused', async () => {
    const email = uniqueEmail('totp-replay');
    await createConfirmedUser(email, PASSWORD);
    const { factorId, secret } = await apiEnroll(await apiSignIn(email, PASSWORD));
    const client = await apiSignIn(email, PASSWORD);

    // Far from the end of a 30-second step, so the code stays the same for both tries.
    if (msUntilNextStep() < 5_000) await new Promise((resolve) => setTimeout(resolve, msUntilNextStep() + 100));
    const challenge = await client.auth.mfa.challenge({ factorId });
    expect(challenge.error).toBeNull();
    const code = totp(secret);
    const first = await client.auth.mfa.verify({ factorId, challengeId: challenge.data!.id, code });
    expect(first.error).toBeNull();

    const replay = await client.auth.mfa.verify({ factorId, challengeId: challenge.data!.id, code });
    expect(replay.error, 'a used challenge can’t be verified again').not.toBeNull();
  });

  test('an enrollment left halfway changes nothing, and can be started again', async ({ page }) => {
    const { email } = await signedIn(page, 'totp-abandon');

    await page.goto('/account');
    await section(page).getByRole('button', { name: 'Turn on two-step verification' }).click();
    await section(page).getByRole('button', { name: 'Continue' }).click();
    await expect(section(page).getByTestId('totp-secret')).toBeVisible();
    // The person leaves without entering a code.
    await page.reload();
    await expect(section(page)).toContainText('Off.');

    await signOut(page);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);

    // Starting again replaces the abandoned app rather than clashing with its name.
    await turnOn(page);
    await expect(section(page).getByRole('listitem')).toHaveCount(1);
  });

  test('removing the last app needs a code in this session, turns it off, and tells the account', async ({ page }) => {
    const { email } = await signedIn(page, 'totp-remove');
    await turnOn(page);

    await section(page).getByRole('button', { name: 'Remove Authenticator app' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove Authenticator app?' });
    await expect(dialog).toContainText('two-step verification turns off');
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(section(page).getByRole('status')).toContainText('two-step verification is off');
    await expect(section(page)).toContainText('Off.');
    await waitForEmail(email, 'An authenticator app was removed from your Xomoni account');

    await signOut(page);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
  });

  test('a password reset by email asks an account with an app for its code before the new password', async ({
    page,
  }) => {
    const email = uniqueEmail('totp-reset');
    await createConfirmedUser(email, PASSWORD);
    const { secret } = await apiEnroll(await apiSignIn(email, PASSWORD));

    await page.goto('/forgot-password');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await submit(page, 'Send reset link');
    await followEmailLink(page, email, 'Reset your Xomoni password');
    // The emailed link alone signs in at aal1: the inbox is not enough to choose a new password.
    await expect(page).toHaveURL(/\/login\/two-factor\?next=%2Freset-password$/);

    await enterCode(page, totp(secret));
    await expect(page).toHaveURL(/\/reset-password$/);
    await passwordInput(page, 'New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/account\?password=updated$/);
  });

  test('changing the password asks an account with an app for a code too', async ({ page }) => {
    const { email } = await signedIn(page, 'totp-password');
    const secret = await turnOn(page);
    const password = page.getByRole('region', { name: 'Password' });

    await passwordInput(page, 'Current password').fill(PASSWORD);
    await passwordInput(page, 'New password').fill(NEW_PASSWORD);
    await password.getByLabel('Code from your authenticator app').fill(totp(secret));
    await submit(page, 'Change password');

    await expect(password.getByText('Your new password is saved.')).toBeVisible();
    await waitForEmail(email, 'Your Xomoni password was changed');
    expect(await emailsTo(email, 'An authenticator app was removed')).toEqual([]);

    // The new password works, with a code.
    await signOut(page);
    await signIn(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/login\/two-factor$/);
    await enterCode(page, totp(secret));
    await expectDashboard(page);
  });
});
