import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILLING_PAGES_VARIABLE, billingPagesOn } from './billing-pages';

describe('the switch of the pages for paid plans (#420)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off when the server sets nothing: the drafts wait for approval', () => {
    vi.stubEnv('BILLING_PAGES', undefined);
    expect(billingPagesOn()).toBe(false);
  });

  it('is on only for BILLING_PAGES=1', () => {
    expect(BILLING_PAGES_VARIABLE).toBe('BILLING_PAGES');
    vi.stubEnv('BILLING_PAGES', '1');
    expect(billingPagesOn()).toBe(true);
    expect(billingPagesOn({ BILLING_PAGES: '1' })).toBe(true);
  });

  it('stays off for anything else, so a typo never publishes the drafts', () => {
    for (const value of ['', '0', 'true', 'yes', 'on', ' 1', '1 ', '01', 'TRUE'])
      expect(billingPagesOn({ BILLING_PAGES: value })).toBe(false);
    expect(billingPagesOn({})).toBe(false);
  });
});
