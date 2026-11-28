import { addProductDocument, createConfirmedUser, makeSuperadmin } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// The private product document at /product/document (ADR-0048), linked from the super-admin console (#516): only a
// super-admin reads or updates it, its versions at /product/documents in the console. The page runs in a sandbox under
// its own Content-Security-Policy, so its scripts can't reach the site's cookies. Versions are seeded with the local
// stack's service-role key, as the maintainer would with SQL.

/** A page whose script records whether it can read the site's cookies. */
const page = (heading: string) =>
  `<!doctype html><html><head><title>${heading}</title></head><body><h1>${heading}</h1>` +
  `<script>try { document.body.dataset.cookies = String(document.cookie.length); } catch (e) { document.body.dataset.cookies = 'blocked'; }</script>` +
  `</body></html>`;

test('a signed-out visitor is sent to the console’s sign-in and back', async ({ page: browser }) => {
  await browser.goto('/product/document');
  await expect(browser).toHaveURL(/\/product\/login\?next=%2Fproduct%2Fdocument$/);
});

test('an ordinary account gets a plain 404 at both addresses', async ({ page: browser }) => {
  const email = uniqueEmail('product-stranger');
  await createConfirmedUser(email, PASSWORD);
  await signIn(browser, email, PASSWORD);
  await expect(browser).toHaveURL(/\/dashboard$/);

  const document = await browser.goto('/product/document');
  expect(document?.status()).toBe(404);
  await expect(browser.getByText('This page could not be found.')).toBeVisible();

  // The versions page is a console page: the proxy answers anyone but a super-admin with a real 404 (#516).
  const versions = await browser.goto('/product/documents');
  expect(versions?.status()).toBe(404);
  await expect(browser.getByText('This page could not be found.')).toBeVisible();
  await expect(browser.getByRole('heading', { name: 'Product document' })).toHaveCount(0);
});

test('a super-admin reads the document sandboxed, uploads a version and opens the older one', async ({
  page: browser,
}) => {
  const email = uniqueEmail('product-admin');
  const userId = await createConfirmedUser(email, PASSWORD);
  await makeSuperadmin(userId);
  const first = `Brand engine ${Date.now()}`;
  const firstId = await addProductDocument(userId, first, page(first));
  await signIn(browser, email, PASSWORD);
  await expect(browser).toHaveURL(/\/dashboard$/);

  const response = await browser.goto('/product/document');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain('sandbox allow-scripts allow-popups');
  expect(headers['content-security-policy']).not.toContain('allow-same-origin');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  await expect(browser.getByRole('heading', { name: first })).toBeVisible();
  // The document's own script ran, in an opaque origin: reading the site's cookies throws.
  await expect(browser.locator('body')).toHaveAttribute('data-cookies', 'blocked');

  await browser.getByRole('link', { name: 'Versions' }).click();
  await expect(browser).toHaveURL(/\/product\/documents$/);
  // In the console, with its sidebar.
  await expect(browser.getByRole('navigation', { name: 'Console' })).toBeVisible();
  await expect(browser.getByRole('row', { name: first })).toContainText('current');

  const second = `${first} (second)`;
  await browser.getByRole('textbox', { name: /Title/ }).fill(second);
  await browser.getByLabel('HTML file').setInputFiles({
    name: 'brand-engine.html',
    mimeType: 'text/html',
    buffer: Buffer.from(page(second)),
  });
  await browser.getByRole('button', { name: 'Save version' }).click();
  await expect(browser.getByRole('status')).toContainText(`Saved “${second}” as the current version.`);
  await expect(browser.getByRole('row', { name: second })).toContainText('current');

  await browser.goto('/product/document');
  await expect(browser.getByRole('heading', { name: second })).toBeVisible();
  await browser.goto(`/product/document?v=${firstId}`);
  await expect(browser.getByRole('heading', { name: first, exact: true })).toBeVisible();
});
