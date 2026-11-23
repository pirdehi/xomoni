import { expect, type Locator } from '@playwright/test';

/**
 * Waits until React has hydrated the element `locator` finds, and returns the locator. The server's HTML shows a button
 * before React drives it, and a click or key press in between does nothing, which a busy runner makes likely: CI runs
 * the website's tests beside the extension's (#404). React keeps an element's props on its DOM node under a
 * `__reactProps$…` key from hydration on, and reads its handlers from there.
 */
export async function hydrated(locator: Locator): Promise<Locator> {
  await expect
    .poll(() => locator.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps$'))), {
      message: 'React drives the element',
    })
    .toBe(true);
  return locator;
}
