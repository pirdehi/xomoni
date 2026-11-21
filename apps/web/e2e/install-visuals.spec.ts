import type { Locator, Page } from '@playwright/test';
import { AGENTS, CHROME_STORE, EDGE_STORE, asBrowser, listIn } from './support/browsers';
import { expect, test } from './support/test';

// The install guide's illustrations (#299, task 1.7), under *Advanced: install from a zip* once a store lists Xomoni:
// the drawing for the visitor's browser, moving and pausable, and one still frame under reduced motion.

const zip = (page: Page) => page.getByRole('region', { name: 'Advanced: install from a zip' });
const steps = (page: Page) => zip(page).getByRole('region', { name: 'Install steps' });

/** Opens /install at *Advanced* and goes to the step that adds Xomoni to the browser. */
async function toAddStep(page: Page, title: string) {
  await page.goto('/install#install-from-a-zip');
  await expect(steps(page).getByText('Step 1 of 5')).toBeVisible();
  for (let i = 0; i < 3; i++) await steps(page).getByRole('button', { name: 'Next' }).click();
  await expect(steps(page).getByRole('heading', { name: title })).toBeVisible();
}

/** How many animations run in a figure's drawing, and how many of them are paused. */
const animations = (figure: Locator) =>
  figure.evaluate((element) => {
    const all = element.querySelector(':scope > svg')!.getAnimations({ subtree: true });
    return { count: all.length, paused: all.filter((animation) => animation.playState === 'paused').length };
  });

test.describe('the install guide’s illustrations (#299)', () => {
  test.describe('in Chrome on a Mac', () => {
    test.use({ userAgent: AGENTS.chrome });

    test('show Developer mode at the top right and the folder dropped on the page, moving, and pause', async ({
      page,
    }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await toAddStep(page, 'Add it to Chrome');

      const developerMode = steps(page).getByRole('figure', { name: /Developer mode switch at the top right/ });
      await expect(developerMode).toHaveAccessibleName(
        'Illustration On chrome://extensions, the Developer mode switch at the top right is turned on, and Load unpacked appears.',
      );
      await expect(developerMode).toHaveAttribute('data-layout', 'top-bar');
      await expect(developerMode).toHaveAttribute('data-frame', 'mac');
      await expect(developerMode.getByText('Illustration', { exact: true })).toBeVisible();
      await expect(steps(page).getByRole('figure', { name: /dragged onto chrome:\/\/extensions/ })).toBeVisible();

      // It moves, Pause holds it where it is, and Play goes on.
      await expect(developerMode).toHaveAttribute('data-motion', 'playing');
      const moving = await animations(developerMode);
      expect(moving.count).toBeGreaterThan(3);
      expect(moving.paused).toBe(0);
      await developerMode.getByRole('button', { name: 'Pause the illustration of turning on Developer mode' }).click();
      await expect(developerMode).toHaveAttribute('data-motion', 'paused');
      expect(await animations(developerMode)).toEqual({ count: moving.count, paused: moving.count });
      await developerMode.getByRole('button', { name: 'Play the illustration of turning on Developer mode' }).click();
      expect((await animations(developerMode)).paused).toBe(0);

      // Following it here: pinning, with the pin.
      await steps(page).getByRole('button', { name: 'Next' }).click();
      await expect(steps(page)).toContainText('then the pin next to Xomoni.');
      const pin = steps(page).getByRole('figure', { name: /the pin next to Xomoni puts it in the toolbar/ });
      await expect(pin).toHaveAttribute('data-control', 'pin');
    });
  });

  test.describe('in Edge on Windows', () => {
    test.use({ userAgent: AGENTS.edge });

    test('show Developer mode in the panel on the left, a Windows window, and the eye to pin', async ({ page }) => {
      await asBrowser(page, 'edge');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await toAddStep(page, 'Add it to Edge');

      const developerMode = steps(page).getByRole('figure', { name: /Developer mode switch in the panel on the left/ });
      await expect(developerMode).toHaveAccessibleName(/^Illustration On edge:\/\/extensions,/);
      await expect(developerMode).toHaveAttribute('data-layout', 'side-panel');
      await expect(developerMode).toHaveAttribute('data-frame', 'windows');
      await expect(steps(page).getByRole('figure', { name: /dragged onto edge:\/\/extensions/ })).toBeVisible();

      await steps(page).getByRole('button', { name: 'Next' }).click();
      const pin = steps(page).getByRole('figure', { name: /the eye next to Xomoni \(Show in toolbar\)/ });
      await expect(pin).toHaveAttribute('data-control', 'eye');
    });
  });

  test.describe('in Brave on a Mac', () => {
    test.use({ userAgent: AGENTS.chrome });

    test('show brave://extensions, laid out like Chrome’s', async ({ page }) => {
      await asBrowser(page, 'brave');
      await listIn(page, { chrome: CHROME_STORE });
      await toAddStep(page, 'Add it to Brave');

      const developerMode = steps(page).getByRole('figure', { name: /^Illustration On brave:\/\/extensions,/ });
      await expect(developerMode).toHaveAttribute('data-layout', 'top-bar');
      await expect(developerMode.locator(':scope > svg')).toContainText('brave://extensions');
      await expect(steps(page).getByRole('figure', { name: /dragged onto brave:\/\/extensions/ })).toBeVisible();
    });
  });

  test.describe('with reduced motion', () => {
    test.use({ userAgent: AGENTS.chrome, reducedMotion: 'reduce' });

    test('stand still on their last frame, with nothing to pause', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE });
      await toAddStep(page, 'Add it to Chrome');

      const figures = steps(page).getByRole('figure');
      await expect(figures).toHaveCount(2);
      for (const figure of await figures.all()) {
        await expect(figure).toHaveAttribute('data-motion', 'still');
        expect(await animations(figure)).toEqual({ count: 0, paused: 0 });
        await expect(figure.getByRole('button')).toHaveCount(0);
      }
      // The last frame: Developer mode on, Load unpacked showing, still saying the same in words.
      await expect(figures.first().locator('[data-part="developer-buttons"]')).toBeVisible();
      await expect(figures.first()).toHaveAccessibleName(/Developer mode switch at the top right is turned on/);
    });
  });
});
