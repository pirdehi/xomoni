// The check of a webhook Polar signed (ADR-0042, decision 3): the Standard Webhooks signature
// (https://www.standardwebhooks.com), an HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, made with Web
// Crypto and compared in constant time by `crypto.subtle.verify`, and only within 5 minutes of its timestamp. The same
// code runs in Node, in the Edge runtime and in a browser. It reads no environment: the route passes the secret.

/** How far a webhook's timestamp may be from the server's clock, either way: 5 minutes. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

/** The three headers Standard Webhooks adds to a delivery. */
export const WEBHOOK_HEADERS = ['webhook-id', 'webhook-timestamp', 'webhook-signature'] as const;

/** Why a delivery isn't Polar's: a header is missing, its time is too far from now, or no signature matches. */
export type WebhookRefusal = 'missing' | 'stale' | 'bad-signature';

/** The result of `verifyWebhook`: the delivery's id and time when its signature holds, or why it doesn't. */
export type WebhookCheck = { ok: true; id: string; timestamp: number } | { ok: false; reason: WebhookRefusal };

/** The headers of a request, as `Request.headers` gives them. */
export interface HeaderReader {
  get(name: string): string | null;
}

// A delivery's id is printable ASCII, and fits the ledger's column (`billing_events.webhook_id`).
const ID = /^[\x21-\x7e]{1,200}$/;
// Seconds since the epoch, as a whole number.
const TIMESTAMP = /^\d{1,12}$/;
// One signature: the version, a comma, then the HMAC in standard base64 (32 bytes).
const SIGNATURE = /^v1,([A-Za-z0-9+/]{43}=)$/;

/**
 * The HMAC key for `secret`, as Polar shows it in its dashboard. Polar's own SDK hands Standard Webhooks' library the
 * secret's UTF-8 bytes in base64, which the library decodes back: the key is those bytes.
 */
function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ]);
}

/**
 * Whether a delivery (its headers and its raw body, exactly as received) was signed by Polar with `secret`, at `now`
 * (milliseconds). Any one of the space-separated `v1,` signatures may match, so Polar can rotate its secret. A missing
 * or malformed header is `missing`; a time more than `WEBHOOK_TOLERANCE_MS` away is `stale`; otherwise a signature
 * that doesn't match is `bad-signature`. Throws only for an empty secret, which is the server's misconfiguration.
 */
export async function verifyWebhook(
  headers: HeaderReader,
  body: string,
  secret: string,
  now: number,
): Promise<WebhookCheck> {
  if (!secret) throw new Error('verifyWebhook needs the webhook secret');
  const id = headers.get('webhook-id') ?? '';
  const timestamp = headers.get('webhook-timestamp') ?? '';
  const signatures = (headers.get('webhook-signature') ?? '').split(' ').filter(Boolean);
  if (!ID.test(id) || !TIMESTAMP.test(timestamp) || signatures.length === 0) return { ok: false, reason: 'missing' };

  const seconds = Number(timestamp);
  if (Math.abs(now - seconds * 1000) > WEBHOOK_TOLERANCE_MS) return { ok: false, reason: 'stale' };

  const key = await hmacKey(secret);
  const content = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const signature of signatures) {
    const encoded = SIGNATURE.exec(signature)?.[1];
    if (!encoded) continue;
    const mac = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (await crypto.subtle.verify('HMAC', key, mac, content)) return { ok: true, id, timestamp: seconds };
  }
  return { ok: false, reason: 'bad-signature' };
}
