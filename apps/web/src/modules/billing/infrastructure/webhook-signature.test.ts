import { TEST_WEBHOOK_SECRET, signTestEvent, subscriptionEvent } from '@test/fakes/polar';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_HEADERS, WEBHOOK_TOLERANCE_MS, verifyWebhook } from './webhook-signature';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const SECONDS = NOW / 1000;
const USER = '00000000-0000-4000-a000-0000000000b1';

/** A delivery of the fake Polar, signed at `timestamp` (seconds) with `secret`, as headers a request would carry. */
function delivery({ secret = TEST_WEBHOOK_SECRET, timestamp = SECONDS, id = 'msg_test_1' } = {}) {
  const { headers, body } = signTestEvent(subscriptionEvent('subscription.active', USER, { at: new Date(NOW) }), {
    secret,
    timestamp,
    id,
  });
  return { headers: new Headers(headers), body };
}

describe('verifyWebhook, the check of a webhook Polar signed (ADR-0042)', () => {
  it('passes an event the fake Polar signed with the same secret, giving its id and time', async () => {
    const { headers, body } = delivery();
    await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toEqual({
      ok: true,
      id: 'msg_test_1',
      timestamp: SECONDS,
    });
  });

  it('refuses the same event signed with another secret', async () => {
    const { headers, body } = delivery({ secret: 'polar_whs_someone_else' });
    await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('refuses a body changed by one character after signing', async () => {
    const { headers, body } = delivery();
    const changed = body.replace('"active"', '"activE"');
    await expect(verifyWebhook(headers, changed, TEST_WEBHOOK_SECRET, NOW)).resolves.toMatchObject({ ok: false });
  });

  it('refuses a signature moved to another delivery id or time, which it also signs', async () => {
    const { headers, body } = delivery();
    headers.set('webhook-id', 'msg_test_2');
    await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toMatchObject({
      reason: 'bad-signature',
    });
    const later = delivery();
    later.headers.set('webhook-timestamp', String(SECONDS + 1));
    await expect(verifyWebhook(later.headers, later.body, TEST_WEBHOOK_SECRET, NOW)).resolves.toMatchObject({
      reason: 'bad-signature',
    });
  });

  it('takes any one of several signatures, so Polar can rotate its secret', async () => {
    const old = delivery({ secret: 'polar_whs_old' });
    const current = delivery();
    const both = `${old.headers.get('webhook-signature')} ${current.headers.get('webhook-signature')}`;
    current.headers.set('webhook-signature', both);
    await expect(verifyWebhook(current.headers, current.body, TEST_WEBHOOK_SECRET, NOW)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('accepts a time up to 5 minutes away, either way, and refuses one further', async () => {
    const edge = WEBHOOK_TOLERANCE_MS / 1000;
    for (const timestamp of [SECONDS - edge, SECONDS + edge]) {
      const { headers, body } = delivery({ timestamp });
      await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toMatchObject({ ok: true });
    }
    for (const timestamp of [SECONDS - edge - 1, SECONDS + edge + 1]) {
      const { headers, body } = delivery({ timestamp });
      await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toEqual({
        ok: false,
        reason: 'stale',
      });
    }
  });

  it('refuses a delivery without one of its three headers', async () => {
    for (const name of WEBHOOK_HEADERS) {
      const { headers, body } = delivery();
      headers.delete(name);
      await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toEqual({
        ok: false,
        reason: 'missing',
      });
    }
  });

  it('refuses malformed headers: a time that is not whole seconds, an id with spaces, an empty signature', async () => {
    const cases: [string, string][] = [
      ['webhook-timestamp', '1764000000.5'],
      ['webhook-timestamp', 'yesterday'],
      ['webhook-id', 'msg with spaces'],
      ['webhook-id', 'x'.repeat(201)],
      ['webhook-signature', '   '],
    ];
    for (const [name, value] of cases) {
      const { headers, body } = delivery();
      headers.set(name, value);
      await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toEqual({
        ok: false,
        reason: 'missing',
      });
    }
  });

  it('ignores a signature of another version or shape, and refuses when none is left', async () => {
    const { headers, body } = delivery();
    const mac = headers.get('webhook-signature')!.slice(3);
    for (const signature of [`v2,${mac}`, `v1,${mac.slice(0, -2)}`, `v1,${mac}x`, 'v1,', mac]) {
      headers.set('webhook-signature', signature);
      await expect(verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, NOW)).resolves.toEqual({
        ok: false,
        reason: 'bad-signature',
      });
    }
  });

  it('refuses to check without a secret: the server is misconfigured, not the delivery', async () => {
    const { headers, body } = delivery();
    await expect(verifyWebhook(headers, body, '', NOW)).rejects.toThrow('needs the webhook secret');
  });
});
