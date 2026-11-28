import { TEST_ACCESS_TOKEN } from '@test/fakes/polar';
import { afterEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: async () => ({ from }) }));

const { billingUrls, endSubscriptionsBeforeDeletion, polarFromEnv } = await import('./purchases');
const { POLAR_FORM_TARGETS } = await import('@/shared/config/security-headers');
const { POLAR_PAGE_ORIGINS } = await import('../domain/checkout');

describe('billing’s server composition (#421)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    from.mockReset();
  });

  it('has no Polar client until its token is set', () => {
    vi.stubEnv('POLAR_ACCESS_TOKEN', '');
    expect(polarFromEnv()).toBeNull();
    vi.stubEnv('POLAR_ACCESS_TOKEN', TEST_ACCESS_TOKEN);
    expect(polarFromEnv()).toEqual(expect.objectContaining({ createCheckout: expect.any(Function) }));
  });

  it('sends Polar back to the site’s own pages, and knows the API it asks', () => {
    vi.stubEnv('POLAR_API_URL', 'https://sandbox-api.polar.sh');
    expect(billingUrls('/pricing')).toEqual({
      success: 'http://localhost:3000/account/billing?checkout=done',
      back: 'http://localhost:3000/pricing',
      api: 'https://sandbox-api.polar.sh',
    });
    vi.stubEnv('POLAR_API_URL', '');
    expect(billingUrls('/account/billing').api).toBe('https://api.polar.sh');
  });

  it('lets a deletion go ahead without Polar when the person never subscribed', async () => {
    vi.stubEnv('POLAR_ACCESS_TOKEN', '');
    from.mockReturnValue({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) });
    await expect(endSubscriptionsBeforeDeletion('u1')).resolves.toEqual({ ok: true });
  });

  it('stops a deletion without Polar while the stored plan is a live subscription', async () => {
    vi.stubEnv('POLAR_ACCESS_TOKEN', '');
    from.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({
          data: { source: 'subscription', status: 'active', valid_until: '2999-01-01T00:00:00Z' },
          error: null,
        }),
      }),
    });
    await expect(endSubscriptionsBeforeDeletion('u1')).resolves.toEqual({ ok: false, code: 'not_configured' });
  });

  it('sends the browser only where the Content-Security-Policy lets a form lead: the same Polar origins', () => {
    expect([...POLAR_PAGE_ORIGINS]).toEqual([...POLAR_FORM_TARGETS]);
  });
});
