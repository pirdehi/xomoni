import { expect, test } from './support/test';

test.describe('security.txt (#150)', () => {
  test('is served as UTF-8 text with the private contacts and a future Expires', async ({ request }) => {
    const response = await request.get('/.well-known/security.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/plain; charset=utf-8$/i);
    const text = await response.text();
    expect(text).toContain('Contact: mailto:privacy@xomoni.com');
    expect(text).toContain('Policy: https://github.com/pirdehi/xomoni/blob/main/SECURITY.md');
    const expires = /^Expires: (.+)$/m.exec(text)?.[1];
    expect(Date.parse(expires ?? '')).toBeGreaterThan(Date.now());
  });
});
