import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
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

// Two-step verification on xomoni.com (#173, ADR-0036) and its user scenarios (docs/scenarios/173-two-step-verification.md,
// #345), against the local stack's real Supabase Auth: TOTP codes are
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

test.describe('two-step verification', { tag: '@task-173' }, () => {
  test('S173-01 turns on with a QR code and its first code, then sign-in asks for a code before the dashboard', async ({
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
    await expectNoSeriousA11yViolations(page);

    await enterCode(page, totp(secret));
    await expectDashboard(page);
  });

  test('S173-02 a session with the password alone reaches no private page, and the server sends it to the code page', async ({
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

  test('S173-03 the database and Supabase Auth refuse an aal1 session of an account with an app', async () => {
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

  test('S173-04 a challenge works once: replaying it with its code is refused', async () => {
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

  test('S173-05 an enrollment left halfway changes nothing, and can be started again', async ({ page }) => {
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

  test('S173-06 removing the last app needs a code in this session, turns it off, and tells the account', async ({
    page,
  }) => {
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

  test('S173-07 a password reset by email asks an account with an app for its code before the new password', async ({
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

  test('S173-08 changing the password asks an account with an app for a code too', async ({ page }) => {
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

  test('S173-09 a code that isn’t six digits is refused on the spot, and the person stays on the code page', async ({
    page,
  }) => {
    const email = uniqueEmail('totp-shape');
    await createConfirmedUser(email, PASSWORD);
    await apiEnroll(await apiSignIn(email, PASSWORD));
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/login\/two-factor$/);
    for (const [code, says] of [
      ['', 'Enter the 6-digit code from your app'],
      ['12345', 'The code has 6 digits'],
      ['12a456', 'The code has only numbers'],
    ] as const) {
      await enterCode(page, code);
      await expect(page.getByLabel('6-digit code')).toHaveAccessibleDescription(says);
      await expect(page).toHaveURL(/\/login\/two-factor$/);
    }
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toHaveCount(0);
  });

  test('S173-10 a wrong first code leaves two-step verification off, and the right one turns it on', async ({
    page,
  }) => {
    await signedIn(page, 'totp-first-wrong');
    await page.goto('/account');
    await section(page).getByRole('button', { name: 'Turn on two-step verification' }).click();
    await section(page).getByRole('button', { name: 'Continue' }).click();
    const secret = (await section(page).getByTestId('totp-secret').innerText()).replace(/\s+/g, '');
    const wrong = totp(secret) === '000000' ? '111111' : '000000';
    await section(page).getByLabel('6-digit code').fill(wrong);
    await section(page).getByRole('button', { name: 'Turn on' }).click();
    await expect(section(page).getByLabel('6-digit code')).toHaveAccessibleDescription(/That code didn’t work/);
    await expect(section(page).getByRole('alert')).toContainText('That code didn’t work');
    await expect(section(page).getByRole('list', { name: 'Your authenticator apps' })).toHaveCount(0);
    await section(page).getByLabel('6-digit code').fill(totp(secret));
    await section(page).getByRole('button', { name: 'Turn on' }).click();
    await expect(section(page).getByRole('status')).toContainText('Two-step verification is on.');
  });

  test('S173-11 a second app can’t take the first one’s name', async ({ page }) => {
    await signedIn(page, 'totp-same-name');
    await turnOn(page);
    await section(page).getByRole('button', { name: 'Add another authenticator app' }).click();
    await section(page).getByLabel('Name this app (optional)').fill('Authenticator app');
    await section(page).getByRole('button', { name: 'Continue' }).click();
    await expect(section(page).getByLabel('Name this app (optional)')).toHaveAccessibleDescription(
      /You already have an app with that name/,
    );
    await expect(section(page).getByRole('img', { name: /QR code/ })).toHaveCount(0);
  });

  test('S173-12 a second app on another device: either app’s code signs in, and the account is told', async ({
    page,
  }) => {
    const { email } = await signedIn(page, 'totp-second');
    const first = await turnOn(page);
    await section(page).getByRole('button', { name: 'Add another authenticator app' }).click();
    await section(page).getByLabel('Name this app (optional)').fill('Tablet');
    await section(page).getByRole('button', { name: 'Continue' }).click();
    const second = (await section(page).getByTestId('totp-secret').innerText()).replace(/\s+/g, '');
    await section(page).getByLabel('6-digit code').fill(totp(second));
    await section(page).getByRole('button', { name: 'Add app' }).click();
    await expect(section(page).getByRole('status')).toContainText('Either app’s code now works when you sign in.');
    await expect(
      section(page).getByRole('list', { name: 'Your authenticator apps' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expect.poll(async () => (await emailsTo(email, 'An authenticator app was added')).length).toBe(2);

    for (const secret of [second, first]) {
      await signOut(page);
      await signIn(page, email, PASSWORD);
      await expect(page).toHaveURL(/\/login\/two-factor$/);
      await enterCode(page, totp(secret));
      await expectDashboard(page);
    }
  });

  test('S173-13 Cancel in the dialog that removes an app keeps it, and two-step verification stays on', async ({
    page,
  }) => {
    const { email } = await signedIn(page, 'totp-keep');
    await turnOn(page);
    await section(page).getByRole('button', { name: 'Remove Authenticator app' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove Authenticator app?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(section(page).getByRole('list', { name: 'Your authenticator apps' })).toContainText(
      'Authenticator app',
    );
    await expect(section(page)).toContainText('On. Signing in asks for a 6-digit code');
    expect(await emailsTo(email, 'An authenticator app was removed')).toEqual([]);
  });

  test('S173-14 Cancel while adding the first app leaves two-step verification off', async ({ page }) => {
    const { email } = await signedIn(page, 'totp-cancel');
    await page.goto('/account');
    await section(page).getByRole('button', { name: 'Turn on two-step verification' }).click();
    await section(page).getByRole('button', { name: 'Continue' }).click();
    await expect(section(page).getByRole('img', { name: /QR code/ })).toBeVisible();
    await section(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(section(page).getByRole('button', { name: 'Turn on two-step verification' })).toBeEnabled();
    await expect(section(page)).toContainText('Off.');
    await signOut(page);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
  });

  test('S173-15 an old code is refused: only the app’s newest codes work', async ({ page }) => {
    const email = uniqueEmail('totp-old');
    await createConfirmedUser(email, PASSWORD);
    const { secret } = await apiEnroll(await apiSignIn(email, PASSWORD));
    await signIn(page, email, PASSWORD);
    await enterCode(page, totp(secret, { step: -10 }));
    await expect(formAlert(page)).toContainText('That code didn’t work');
    await expect(page).toHaveURL(/\/login\/two-factor$/);
    // The field is emptied, ready for the newest code.
    await expect(page.getByLabel('6-digit code')).toHaveValue('');
    await enterCode(page, totp(secret));
    await expectDashboard(page);
  });

  test('S173-16 Sign out on the code page ends the half-done sign-in: the dashboard asks to sign in again', async ({
    page,
  }) => {
    const email = uniqueEmail('totp-leave');
    await createConfirmedUser(email, PASSWORD);
    await apiEnroll(await apiSignIn(email, PASSWORD));
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/login\/two-factor$/);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toHaveCount(0);
  });

  test('S173-17 an account with no app is off, offers to turn it on, and signs in with the password alone', async ({
    page,
  }) => {
    const { email } = await signedIn(page, 'totp-none');
    await page.goto('/account');
    await expect(section(page)).toContainText('Off. Add an authenticator app');
    await expect(section(page).getByRole('button', { name: 'Turn on two-step verification' })).toBeEnabled();
    await expect(section(page).getByRole('list', { name: 'Your authenticator apps' })).toHaveCount(0);
    await signOut(page);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
  });

  test('S173-18 keyboard only: the code page starts in its field, a code typed as the app shows it and Enter sign in', async ({
    page,
  }) => {
    const email = uniqueEmail('totp-keys');
    await createConfirmedUser(email, PASSWORD);
    const { secret } = await apiEnroll(await apiSignIn(email, PASSWORD));
    await signIn(page, email, PASSWORD);
    await expect(page.getByLabel('6-digit code')).toBeFocused();
    const code = totp(secret);
    // As an authenticator app shows it: two groups of three.
    await page.keyboard.type(`${code.slice(0, 3)} ${code.slice(3)}`);
    await page.keyboard.press('Enter');
    await expectDashboard(page);
  });

  test('S173-19 adding an app and the code page have no serious accessibility violation, in light and dark', async ({
    page,
  }) => {
    await signedIn(page, 'totp-axe');
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto('/account');
      await section(page).getByRole('button', { name: 'Turn on two-step verification' }).click();
      await section(page).getByRole('button', { name: 'Continue' }).click();
      await expect(section(page).getByRole('img', { name: /QR code/ })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('S173-20 the QR code, the key and the code fit the screen, with nothing to scroll sideways', async ({
      page,
    }) => {
      await signedIn(page, 'totp-phone');
      await page.goto('/account');
      await section(page).getByRole('button', { name: 'Turn on two-step verification' }).click();
      await section(page).getByRole('button', { name: 'Continue' }).click();
      await expect(section(page).getByRole('img', { name: /QR code/ })).toBeInViewport({ ratio: 0.5 });
      await expect(section(page).getByTestId('totp-secret')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(0);
    });
  });

  test('S173-21 once verified, the session keeps its code: reloads and other pages ask for none, a new browser does', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail('totp-keep-session');
    await createConfirmedUser(email, PASSWORD);
    const { secret } = await apiEnroll(await apiSignIn(email, PASSWORD));
    await signIn(page, email, PASSWORD);
    await enterCode(page, totp(secret));
    await expectDashboard(page);
    await page.reload();
    await expectDashboard(page);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();

    const other = await browser.newContext();
    const fresh = await other.newPage();
    await signIn(fresh, email, PASSWORD);
    await expect(fresh).toHaveURL(/\/login\/two-factor$/);
    await other.close();
  });

  test('S173-22 the QR code is drawn in the page from the key, which no request carries', async ({ page }) => {
    await signedIn(page, 'totp-qr');
    const sent: string[] = [];
    page.on('request', (request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    await page.goto('/account');
    await section(page).getByRole('button', { name: 'Turn on two-step verification' }).click();
    await section(page).getByRole('button', { name: 'Continue' }).click();
    const qr = section(page).getByRole('img', { name: /QR code/ });
    await expect(qr).toBeVisible();
    // An image in the page itself, not one fetched from a QR code service.
    expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    const secret = (await section(page).getByTestId('totp-secret').innerText()).replace(/\s+/g, '');
    await section(page).getByLabel('6-digit code').fill(totp(secret));
    await section(page).getByRole('button', { name: 'Turn on' }).click();
    await expect(section(page).getByRole('status')).toContainText('Two-step verification is on.');
    expect(sent.filter((line) => line.includes(secret) || line.includes(secret.toLowerCase()))).toEqual([]);
  });

  test('S173-23 without the app, the code page offers no way around the code: only the slow way through support', async ({
    page,
  }) => {
    const email = uniqueEmail('totp-lost');
    await createConfirmedUser(email, PASSWORD);
    await apiEnroll(await apiSignIn(email, PASSWORD));
    await signIn(page, email, PASSWORD);
    await page.getByText('Lost your authenticator app?').click();
    await expect(
      page.getByText(/We then remove your authenticator apps after \d+ days, and tell that address/),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /@/ })).toHaveAttribute('href', /^mailto:/);
    const buttons = await page.getByRole('main').getByRole('button').allInnerTexts();
    expect(buttons.map((text) => text.trim())).toEqual(['Verify', 'Sign out']);
  });

  test('S173-24 the code page owes nothing to a session without an app: it goes on, or to sign in', async ({
    page,
    browser,
  }) => {
    await signedIn(page, 'totp-owes-nothing');
    await page.goto(`/login/two-factor?next=${encodeURIComponent('/account')}`);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();

    const visitor = await browser.newContext();
    const signedOut = await visitor.newPage();
    await signedOut.goto('/login/two-factor');
    await expect(signedOut).toHaveURL(/\/login(\?|$)/);
    await expect(signedOut.getByLabel('6-digit code')).toHaveCount(0);
    await visitor.close();
  });

  test('S173-25 a removed app’s codes stop working, while the other app’s still sign in', async ({ page }) => {
    const email = uniqueEmail('totp-removed');
    await createConfirmedUser(email, PASSWORD);
    const owner = await apiSignIn(email, PASSWORD);
    const lost = await apiEnroll(owner, 'Old phone');
    const kept = await apiEnroll(owner, 'New phone');
    const removal = await owner.auth.mfa.unenroll({ factorId: lost.factorId });
    expect(removal.error).toBeNull();

    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/login\/two-factor$/);
    await enterCode(page, totp(lost.secret));
    await expect(formAlert(page)).toContainText('That code didn’t work');
    await enterCode(page, totp(kept.secret));
    await expectDashboard(page);
  });
});
