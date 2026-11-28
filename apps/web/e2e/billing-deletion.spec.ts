import type { Page } from '@playwright/test';
import { subscriptionEvent } from '../test/fakes/polar';
import { applyBillingEvent, createConfirmedUser, entitlementOf } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { withFakePolar } from './support/polar';
import { expect, test } from './support/test';

// Deleting an account that pays (#421, ADR-0042): the site revokes at Polar every subscription that can still charge,
// then deletes the account, and its plan with it. If Polar can't be asked, nothing is deleted. The fake Polar answers
// on 127.0.0.1:4010, where the site's server looks for it in these tests; nothing leaves the computer.

const DAY = 86_400_000;

/** A new account on Plus, signed in on `page`; returns its id and the subscription Polar holds for it. */
async function payingAccount(page: Page, label: string) {
  const email = uniqueEmail(label);
  const userId = await createConfirmedUser(email, PASSWORD);
  const subscription = subscriptionEvent('subscription.active', userId).data;
  await applyBillingEvent({
    webhook_id: `seed_${userId}`,
    event_type: 'subscription.active',
    event_at: new Date().toISOString(),
    user_id: userId,
    tier: 'plus',
    status: 'active',
    source: 'subscription',
    valid_until: new Date(Date.now() + 20 * DAY).toISOString(),
  });
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  return { userId, subscription };
}

/** Asks for the account's deletion on /account, as a person does. */
async function deleteAccount(page: Page) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete my Xomoni account' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete your Xomoni account?' });
  await confirm.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.getByRole('button', { name: 'Delete account' }).click();
}

test.describe('deleting an account that pays (#421)', () => {
  test('its subscription is revoked at Polar first, then the account and its plan are deleted', async ({ page }) => {
    const { userId, subscription } = await payingAccount(page, 'delete-paying');
    await withFakePolar(async (polar) => {
      polar.api.subscriptions.set(userId, [subscription]);
      await deleteAccount(page);
      await expect(page).toHaveURL(/\/\?account=deleted$/);
      expect(polar.api.revoked).toEqual([subscription.id]);
    });
    expect(await entitlementOf(userId)).toBeNull();
  });

  test('when Polar cannot be asked, nothing is deleted and the person is told why', async ({ page }) => {
    const { userId } = await payingAccount(page, 'delete-no-polar');
    // No fake Polar runs: the site's server can't reach Polar.
    await deleteAccount(page);
    await expect(page.getByText('We couldn’t cancel your subscription with Polar')).toBeVisible();
    await expect(page).toHaveURL(/\/account$/);
    expect(await entitlementOf(userId)).toMatchObject({ tier: 'plus', status: 'active' });
  });
});
