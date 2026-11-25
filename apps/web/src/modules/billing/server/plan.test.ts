import { beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = vi.fn<() => Promise<unknown>>();
const rpc = vi.fn<(name: string) => Promise<unknown>>();
vi.mock('@/modules/auth/server/session', () => ({ currentViewer: () => viewer() }));
vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }));

const { currentPlan } = await import('./plan');

describe('currentPlan (#421, CB.2.5)', () => {
  beforeEach(() => {
    viewer.mockReset();
    rpc.mockReset();
  });

  it('reads no plan for a visitor, only whether sales are open', async () => {
    viewer.mockResolvedValue(null);
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(currentPlan()).resolves.toEqual({ state: 'signed_out', live: false });
    expect(rpc).toHaveBeenCalledWith('billing_live');
    expect(rpc).not.toHaveBeenCalledWith('my_entitlement');
  });

  it('reads the signed-in person’s own plan with their session', async () => {
    viewer.mockResolvedValue({ id: 'u1' });
    rpc.mockResolvedValue({
      data: {
        entitlement: { tier: 'plus', status: 'active', valid_until: '2026-12-24T00:00:00+00:00' },
        billing_live: false,
      },
      error: null,
    });
    await expect(currentPlan()).resolves.toEqual({
      state: 'known',
      tier: 'plus',
      status: 'active',
      validUntil: new Date('2026-12-24T00:00:00Z'),
      live: false,
    });
    expect(rpc).toHaveBeenCalledWith('my_entitlement');
  });

  it('says it couldn’t check when Supabase fails', async () => {
    viewer.mockResolvedValue({ id: 'u1' });
    rpc.mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
    await expect(currentPlan()).resolves.toEqual({ state: 'unavailable', live: null });
  });
});
