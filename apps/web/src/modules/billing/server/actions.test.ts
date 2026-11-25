import { redirectOf } from '@test/server-helpers';
import { NavigationThrow } from '@test/fakes/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BILLING_ERROR_MESSAGES } from '../domain/checkout';
import type { PlanView } from '../domain/plan';

const requireViewer = vi.fn<(returnTo: string) => Promise<{ id: string }>>();
const plan = vi.fn<() => Promise<PlanView>>();
const polar = {
  createCheckout: vi.fn(),
  createPortal: vi.fn(),
  subscriptionsOf: vi.fn(),
  revokeSubscription: vi.fn(),
};
const apply = vi.fn();
vi.mock('@/modules/auth/server/session', () => ({ requireViewer: (to: string) => requireViewer(to) }));
vi.mock('./plan', () => ({ currentPlan: () => plan() }));
vi.mock('./purchases', () => ({
  polarFromEnv: () => polar,
  billingUrls: (back: string) => ({
    success: 'https://xomoni.com/account/billing?checkout=done',
    back,
    api: 'https://api.polar.sh',
  }),
}));
vi.mock('../infrastructure/supabase-admin', () => ({ adminBillingStore: () => ({ apply }) }));
vi.mock('./config', () => ({
  billingCatalog: () => ({ products: new Map(), foundingDiscountId: null }),
  productFor: () => 'prod_plus_month',
}));

const { openBillingPortal, refreshPlan, startCheckout } = await import('./actions');

const USER = '00000000-0000-4000-a000-0000000000b1';
const FREE: PlanView = { state: 'known', tier: 'free', status: null, validUntil: null, live: true };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('billing’s Server Actions (#421)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireViewer.mockResolvedValue({ id: USER });
    plan.mockResolvedValue(FREE);
  });

  it('sends a signed-out visitor to sign in and back to /pricing, buying nothing', async () => {
    requireViewer.mockRejectedValue(new NavigationThrow('/login?next=%2Fpricing'));
    expect(await redirectOf(startCheckout({}, form({ plan: 'plus', interval: 'month' })))).toBe(
      '/login?next=%2Fpricing',
    );
    expect(polar.createCheckout).not.toHaveBeenCalled();
  });

  it('sends the buyer to Polar’s checkout for their own account', async () => {
    polar.createCheckout.mockResolvedValue({ ok: true, value: { url: 'https://buy.polar.sh/polar_c_1' } });
    expect(await redirectOf(startCheckout({}, form({ plan: 'plus', interval: 'month' })))).toBe(
      'https://buy.polar.sh/polar_c_1',
    );
    expect(polar.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, productId: 'prod_plus_month' }),
    );
  });

  it('refuses a tampered form with a message', async () => {
    expect(await startCheckout({}, form({ plan: 'plus', interval: 'month', price: '0' }))).toEqual({
      error: BILLING_ERROR_MESSAGES.unknown_plan,
    });
    expect(polar.createCheckout).not.toHaveBeenCalled();
  });

  it('sends a person who already pays to Billing', async () => {
    plan.mockResolvedValue({ ...FREE, tier: 'plus', status: 'active' });
    expect(await redirectOf(startCheckout({}, form({ plan: 'pro', interval: 'month' })))).toBe('/account/billing');
  });

  it('opens the portal, or says there is nothing to manage', async () => {
    polar.createPortal.mockResolvedValue({ ok: true, value: { url: 'https://polar.sh/xomoni/portal?t=1' } });
    expect(await redirectOf(openBillingPortal())).toBe('https://polar.sh/xomoni/portal?t=1');
    expect(requireViewer).toHaveBeenCalledWith('/account/billing');
    polar.createPortal.mockResolvedValue({ ok: false, failure: 'not_found' });
    expect(await openBillingPortal()).toEqual({ error: BILLING_ERROR_MESSAGES.no_purchases });
  });

  it('refreshes once, then asks the person to wait', async () => {
    polar.subscriptionsOf.mockResolvedValue({ ok: true, value: [] });
    expect(await refreshPlan()).toEqual({ refreshed: 'nothing' });
    expect(await refreshPlan()).toEqual({ error: BILLING_ERROR_MESSAGES.too_soon });
  });
});
