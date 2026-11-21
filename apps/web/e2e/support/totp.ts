import { createHmac } from 'node:crypto';

/**
 * A code from an authenticator app, made from the secret xomoni.com shows when adding one (#173): RFC 6238 with the
 * settings Supabase uses (HMAC-SHA1, 30-second steps, 6 digits). The tests type it as a person would copy it from
 * their phone. `at` is the time to make it for, in epoch milliseconds; `step` moves it by whole 30-second steps.
 */
export function totp(secret: string, { at = Date.now(), step = 0 }: { at?: number; step?: number } = {}): string {
  const counter = Math.floor(at / 1000 / 30) + step;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Milliseconds until the current 30-second step ends, to wait for a fresh code. */
export function msUntilNextStep(at = Date.now()): number {
  return 30_000 - (at % 30_000);
}

/** Decodes RFC 4648 base-32 (the secret's alphabet), ignoring spaces, padding and case. */
function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`not base-32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
