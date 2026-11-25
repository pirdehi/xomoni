import { describe, expect, it } from 'vitest';
import type { PlanReading } from '../domain/plan';
import { readEntitlement } from './read-entitlement';

const PLUS: PlanReading = { tier: 'plus', status: 'active', validUntil: new Date('2026-12-24T00:00:00Z'), live: true };

describe('readEntitlement (#421, CB.2.5)', () => {
  it('reads no plan for a visitor who isn’t signed in, only whether sales are open', async () => {
    let asked = false;
    await expect(
      readEntitlement({
        signedIn: async () => false,
        read: async () => {
          asked = true;
          return PLUS;
        },
        live: async () => true,
      }),
    ).resolves.toEqual({ state: 'signed_out', live: true });
    expect(asked).toBe(false);
    await expect(
      readEntitlement({
        signedIn: async () => false,
        read: async () => PLUS,
        live: () => Promise.reject(new Error('x')),
      }),
    ).resolves.toEqual({ state: 'signed_out', live: null });
  });

  it('gives a signed-in person their plan', async () => {
    await expect(
      readEntitlement({ signedIn: async () => true, read: async () => PLUS, live: async () => true }),
    ).resolves.toEqual({
      state: 'known',
      ...PLUS,
    });
  });

  it('says it couldn’t check, never Free, when the plan can’t be read or the read throws', async () => {
    await expect(
      readEntitlement({ signedIn: async () => true, read: async () => null, live: async () => true }),
    ).resolves.toEqual({
      state: 'unavailable',
      live: null,
    });
    await expect(
      readEntitlement({
        signedIn: async () => true,
        read: () => Promise.reject(new Error('network')),
        live: async () => true,
      }),
    ).resolves.toMatchObject({ state: 'unavailable' });
  });
});
