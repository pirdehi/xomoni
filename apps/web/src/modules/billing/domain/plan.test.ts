import { describe, expect, it } from 'vitest';
import { hasPaidPlan } from './plan';

describe('hasPaidPlan', () => {
  it('is true only for a paid plan that counts now', () => {
    expect(hasPaidPlan({ state: 'known', tier: 'plus', status: 'active', validUntil: null, live: true })).toBe(true);
    expect(hasPaidPlan({ state: 'known', tier: 'pro', status: 'canceled', validUntil: null, live: true })).toBe(true);
    expect(hasPaidPlan({ state: 'known', tier: 'free', status: 'revoked', validUntil: null, live: true })).toBe(false);
    expect(hasPaidPlan({ state: 'signed_out', live: null })).toBe(false);
    expect(hasPaidPlan({ state: 'unavailable', live: null })).toBe(false);
  });
});
