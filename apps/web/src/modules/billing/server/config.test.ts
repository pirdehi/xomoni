import { TEST_FOUNDING_DISCOUNT, TEST_PRODUCTS } from '@test/fakes/polar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASS_DAYS, POLAR_API_DEFAULT, billingCatalog, billingEnv, polarSettings, productFor } from './config';

describe('billing’s configuration (#421)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps each product id to the plan it sells, and the pass to 30 days', () => {
    const catalog = billingCatalog({ ...TEST_PRODUCTS, POLAR_FOUNDING_DISCOUNT_ID: TEST_FOUNDING_DISCOUNT });
    expect(Object.fromEntries(catalog.products)).toEqual({
      prod_plus_monthly_test: { tier: 'plus', source: 'subscription' },
      prod_plus_yearly_test: { tier: 'plus', source: 'subscription' },
      prod_pro_monthly_test: { tier: 'pro', source: 'subscription' },
      prod_pro_yearly_test: { tier: 'pro', source: 'subscription' },
      prod_plus_pass_test: { tier: 'plus', source: 'pass', passDays: PASS_DAYS },
    });
    expect(PASS_DAYS).toBe(30);
    expect(catalog.foundingDiscountId).toBe(TEST_FOUNDING_DISCOUNT);
  });

  it('sells nothing while the products aren’t set, and has no founders’ discount when it is closed', () => {
    expect(billingCatalog({})).toEqual({ products: new Map(), foundingDiscountId: null });
    expect(billingCatalog({ POLAR_PRODUCT_PLUS_MONTHLY: '  ', POLAR_FOUNDING_DISCOUNT_ID: ' ' })).toEqual({
      products: new Map(),
      foundingDiscountId: null,
    });
  });

  it('reads the server’s environment', () => {
    vi.stubEnv('POLAR_PRODUCT_PRO_MONTHLY', 'prod_from_env');
    vi.stubEnv('POLAR_WEBHOOK_SECRET', 'polar_whs_env');
    expect(billingEnv()).toMatchObject({
      POLAR_PRODUCT_PRO_MONTHLY: 'prod_from_env',
      POLAR_WEBHOOK_SECRET: 'polar_whs_env',
    });
    expect(billingCatalog().products.get('prod_from_env')).toEqual({ tier: 'pro', source: 'subscription' });
  });

  it('has Polar’s settings only with a token, at production’s API unless another is named', () => {
    expect(polarSettings({})).toBeNull();
    expect(polarSettings({ POLAR_ACCESS_TOKEN: ' ' })).toBeNull();
    expect(polarSettings({ POLAR_ACCESS_TOKEN: 'tok' })).toEqual({ baseUrl: POLAR_API_DEFAULT, token: 'tok' });
    expect(polarSettings({ POLAR_ACCESS_TOKEN: 'tok', POLAR_API_URL: 'https://sandbox-api.polar.sh' })).toEqual({
      baseUrl: 'https://sandbox-api.polar.sh',
      token: 'tok',
    });
  });

  it('finds each purchase’s product, and none that isn’t set', () => {
    expect(productFor({ plan: 'plus', interval: 'month' }, TEST_PRODUCTS)).toBe('prod_plus_monthly_test');
    expect(productFor({ plan: 'plus', interval: 'year' }, TEST_PRODUCTS)).toBe('prod_plus_yearly_test');
    expect(productFor({ plan: 'pro', interval: 'month' }, TEST_PRODUCTS)).toBe('prod_pro_monthly_test');
    expect(productFor({ plan: 'pro', interval: 'year' }, TEST_PRODUCTS)).toBe('prod_pro_yearly_test');
    expect(productFor({ plan: 'pass' }, TEST_PRODUCTS)).toBe('prod_plus_pass_test');
    expect(productFor({ plan: 'pass' }, {})).toBeNull();
  });
});
