import { afterEach, describe, expect, it, vi } from 'vitest';
import sitemap from './sitemap';

describe('sitemap.xml', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists the public pages, and not the drafts for paid plans while they are off (#420)', () => {
    vi.stubEnv('BILLING_PAGES', undefined);
    expect(sitemap().map(({ url }) => url)).toEqual([
      'https://xomoni.com',
      'https://xomoni.com/install',
      'https://xomoni.com/risks',
      'https://xomoni.com/privacy',
      'https://xomoni.com/terms',
      'https://xomoni.com/login',
      'https://xomoni.com/signup',
    ]);
  });

  it('lists the terms of sale and the refund policy once they are shown', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    expect(sitemap().map(({ url }) => url)).toContain('https://xomoni.com/terms-of-sale');
    expect(sitemap().map(({ url }) => url)).toContain('https://xomoni.com/refunds');
    expect(sitemap().map(({ url }) => url)).toContain('https://xomoni.com/pricing');
  });
});
