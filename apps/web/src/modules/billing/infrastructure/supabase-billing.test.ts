import { describe, expect, it, vi } from 'vitest';
import { readMyEntitlement } from './supabase-billing';

const answering = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) }) as never;

describe('readMyEntitlement (#421, CB.2.5)', () => {
  it('reads the plan and the switch from my_entitlement()', async () => {
    const supabase = answering({
      entitlement: { tier: 'pro', status: 'trialing', valid_until: '2026-12-08T10:00:00.000+00:00' },
      billing_live: true,
    });
    await expect(readMyEntitlement(supabase)).resolves.toEqual({
      tier: 'pro',
      status: 'trialing',
      validUntil: new Date('2026-12-08T10:00:00.000Z'),
      live: true,
    });
  });

  it('reads an account that never paid as Free', async () => {
    await expect(
      readMyEntitlement(
        answering({ entitlement: { tier: 'free', status: null, valid_until: null }, billing_live: false }),
      ),
    ).resolves.toEqual({ tier: 'free', status: null, validUntil: null, live: false });
  });

  it('gives no reading for an error, two-step verification owed included, or an answer it doesn’t know', async () => {
    for (const supabase of [
      answering(null, { message: 'Enter a code from your authenticator app first.', hint: 'second_factor_required' }),
      answering(null),
      answering([]),
      answering({ entitlement: { tier: 'free', status: null, valid_until: null } }),
      answering({ entitlement: { tier: 'gold', status: null, valid_until: null }, billing_live: false }),
      answering({ entitlement: null, billing_live: true }),
    ])
      await expect(readMyEntitlement(supabase)).resolves.toBeNull();
  });
});
