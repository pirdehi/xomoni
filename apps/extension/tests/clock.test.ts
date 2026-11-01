// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { classify } from '../src/content/actor';
import { clockAhead, resetAtFrom } from '../src/content/net';

const MINUTE = 60_000;
/** X's clock when the response was sent, as its `date` header says it (whole seconds). */
const X_NOW = Date.parse('Sun, 01 Nov 2026 12:00:00 GMT');
const DATE = new Date(X_NOW).toUTCString();
/** X's window resets 10 minutes later, on X's clock. */
const RESET_SECONDS = String((X_NOW + 10 * MINUTE) / 1000);

describe('reset times on a skewed system clock (#31, PLAYBOOK F7)', () => {
  it('moves the reset later by as much as this clock runs ahead of X’s', () => {
    const headers = { 'x-rate-limit-reset': RESET_SECONDS, date: DATE };
    expect(clockAhead(DATE, X_NOW + 5 * MINUTE)).toBe(5 * MINUTE);
    expect(resetAtFrom(headers, X_NOW + 5 * MINUTE)).toBe(X_NOW + 15 * MINUTE);
  });

  it('leaves the reset as X sent it when this clock runs behind, so Xomoni only waits longer', () => {
    const headers = { 'x-rate-limit-reset': RESET_SECONDS, date: DATE };
    expect(clockAhead(DATE, X_NOW - 3 * MINUTE)).toBe(-3 * MINUTE);
    expect(resetAtFrom(headers, X_NOW - 3 * MINUTE)).toBe(X_NOW + 10 * MINUTE);
  });

  it('uses the reset as X sent it without a usable date header', () => {
    expect(resetAtFrom({ 'x-rate-limit-reset': RESET_SECONDS }, X_NOW + 5 * MINUTE)).toBe(X_NOW + 10 * MINUTE);
    expect(resetAtFrom({ 'x-rate-limit-reset': RESET_SECONDS, date: 'not a date' }, X_NOW + 5 * MINUTE)).toBe(
      X_NOW + 10 * MINUTE,
    );
    expect(resetAtFrom({ date: DATE }, X_NOW)).toBeNull();
  });

  it('corrects the reset of a rate-limited action too', () => {
    const result = classify(
      {
        op: 'DeleteTweet',
        status: 429,
        headers: { 'x-rate-limit-reset': RESET_SECONDS, date: DATE },
        variables: {},
        json: null,
        at: X_NOW + 2 * MINUTE,
      },
      'DeleteTweet',
    );
    expect(result).toMatchObject({ outcome: 'rate_limited', resetAt: X_NOW + 12 * MINUTE });
  });
});
