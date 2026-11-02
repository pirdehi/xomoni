import { createConfirmedUser } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

test.describe('connecting a browser with a one-time code (ADR-0018)', () => {
  test('the extension pairs with the code, reports a job, and the dashboard shows both live', async ({ page }) => {
    const email = uniqueEmail('pair');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await expect(page.getByText('Live', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Get a code to connect a browser' }).click();
    const code = (await page.getByLabel('Pairing code').textContent()) ?? '';
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);

    // A wrong code is refused; the right one, typed in lower case, pairs.
    expect((await asExtension('pair_device', { code: 'ZZZZZ-ZZZZZ', name: 'Chrome', version: '0.3.0' })).status).toBe(
      400,
    );
    const paired = await asExtension('pair_device', {
      code: code.toLowerCase(),
      name: 'Chrome on macOS',
      version: '0.3.0',
    });
    expect(paired.status).toBe(200);
    const [{ token }] = paired.json as [{ device_id: string; token: string }];

    await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText('Chrome on macOS');

    const report = await asExtension('device_report', {
      token,
      version: '0.3.0',
      jobs: [
        {
          local_id: 'job-1',
          x_handle: 'pair_x',
          kind: 'cleanup',
          title: 'Delete posts older than Jan 1, 2018',
          state: 'running',
          matched: 39,
          done: 3,
          risk_level: 0,
        },
      ],
    });
    expect(report.status).toBe(204);
    await expect(page.getByRole('region', { name: 'Jobs' })).toContainText('Delete posts older than Jan 1, 2018');

    // The code was used up.
    expect((await asExtension('pair_device', { code, name: 'Another', version: '0.3.0' })).status).toBe(400);
  });
});
