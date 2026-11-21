import type { Page } from '@playwright/test';
import { SECTIONS, sectionHref } from '../src/modules/dashboard/domain/sections';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Every page of xomoni.com, checked by axe-core in light and dark mode (#342): no serious or critical violation. The
// tests of each feature check its other states (an error, an open dialog or menu) where they reach them.

/** The pages anyone can open, signed out. */
const PUBLIC = [
  '/',
  '/install',
  '/welcome',
  '/login',
  '/signup',
  '/forgot-password',
  '/connect',
  '/privacy',
  '/terms',
  '/risks',
];

/** Every place of the dashboard, in the menu's order, then the account page. */
const SIGNED_IN = [...SECTIONS.map((section) => sectionHref(section.id)), '/account'];

/** Opens `path` and checks it once its main heading shows. */
async function check(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`no serious accessibility violation, in ${colorScheme} mode (#342)`, () => {
    test.use({ colorScheme });
    // A page at a time, each settling before axe reads it: longer than one flow.
    test.describe.configure({ timeout: 180_000 });

    test('on any page a visitor can open, signed out', async ({ page }) => {
      for (const path of PUBLIC) await check(page, path);
    });

    test('on any place of the dashboard, and the account page', async ({ page }) => {
      const email = uniqueEmail(`a11y-${colorScheme}`);
      await createConfirmedUser(email, PASSWORD);
      await signIn(page, email, PASSWORD);
      await expectDashboard(page);
      for (const path of SIGNED_IN) await check(page, path);
    });
  });
}
