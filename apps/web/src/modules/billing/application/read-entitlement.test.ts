import { describe, expect, it } from 'vitest';
import type { PlanReading } from '../domain/plan';
import { readEntitlement } from './read-entitlement';

const PLUS: PlanReading = { tier: 'plus', status: 'active', validUntil: new Date('2026-12-24T00:00:00Z'), live: true };

describe('readEntitlement (#421, CB.2.5)', () => {
  it('reads no plan for a visitor who isn’t signed in', async () => {
    let asked = false;
    await expect(
      readEntitlement({
        signedIn: async () => false,
        read: async () => {
          asked = true;
          return PLUS;
        },
      }),
    ).resolves.toEqual({ state: 'signed_out', live: null });
    expect(asked).toBe(false);
  });

  it('gives a signed-in person their plan', async () => {
    await expect(readEntitlement({ signedIn: async () => true, read: async () => PLUS })).resolves.toEqual({
      state: 'known',
      ...PLUS,
    });
  });

  it('says it couldn’t check, never Free, when the plan can’t be read or the read throws', async () => {
    await expect(readEntitlement({ signedIn: async () => true, read: async () => null })).resolves.toEqual({
      state: 'unavailable',
      live: null,
    });
    await expect(
      readEntitlement({
        signedIn: async () => true,
        read: () => Promise.reject(new Error('network')),
      }),
    ).resolves.toMatchObject({ state: 'unavailable' });
  });
});
