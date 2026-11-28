import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingChange } from '../domain/polar-event';

const rpc = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ rpc }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

const { SERVICE_ROLE_VARIABLE, adminBillingStore } = await import('./supabase-admin');

const CHANGE: BillingChange = {
  type: 'subscription.active',
  at: '2026-11-24T10:00:00.000Z',
  userId: '00000000-0000-4000-a000-0000000000b1',
  tier: 'plus',
  status: 'active',
  source: 'subscription',
  validUntil: '2026-12-24T10:00:00.000Z',
  cancelAtPeriodEnd: false,
  founding: true,
  polarCustomerId: 'cus_1',
  polarSubscriptionId: 'sub_1',
};

describe('the webhook’s service-role store (ADR-0042)', () => {
  beforeEach(() => {
    rpc.mockReset();
    createClient.mockClear();
  });

  it('is not there without the key, so the webhook says billing isn’t configured', () => {
    expect(SERVICE_ROLE_VARIABLE).toBe('SUPABASE_SERVICE_ROLE_KEY');
    expect(adminBillingStore(undefined)).toBeNull();
    expect(adminBillingStore('')).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps no session, and writes only through apply_billing_event, with the change’s fields', async () => {
    rpc.mockResolvedValue({ data: 'applied', error: null });
    const store = adminBillingStore('service-role-key-for-the-test', 'http://127.0.0.1:54321')!;
    await expect(store.apply('msg_1', CHANGE)).resolves.toBe('applied');
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'service-role-key-for-the-test', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(rpc).toHaveBeenCalledWith('apply_billing_event', {
      webhook_id: 'msg_1',
      event_type: 'subscription.active',
      event_at: CHANGE.at,
      user_id: CHANGE.userId,
      tier: 'plus',
      status: 'active',
      source: 'subscription',
      valid_until: CHANGE.validUntil,
      cancel_at_period_end: false,
      founding: true,
      polar_customer_id: 'cus_1',
      polar_subscription_id: 'sub_1',
    });
  });

  it('sends no subscription id for a pass', async () => {
    rpc.mockResolvedValue({ data: 'stale', error: null });
    const store = adminBillingStore('key')!;
    await expect(store.apply('msg_2', { ...CHANGE, source: 'pass', polarSubscriptionId: null })).resolves.toBe('stale');
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty('polar_subscription_id');
  });

  it('throws on the database’s error without passing its message on, and on an answer it doesn’t know', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation "public.entitlements" violates …' } });
    const store = adminBillingStore('key')!;
    await expect(store.apply('msg_3', CHANGE)).rejects.toThrow(/^apply_billing_event failed$/);
    rpc.mockResolvedValue({ data: 'done', error: null });
    await expect(store.apply('msg_4', CHANGE)).rejects.toThrow('answered oddly');
  });
});
