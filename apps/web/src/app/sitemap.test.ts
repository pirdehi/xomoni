import { afterEach, describe, expect, it, vi } from 'vitest';
import sitemap from './sitemap';

describe('sitemap.xml', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists the public pages, and not the drafts for paid plans while they are off (#420)', () => {
    vi.stubEnv('BILLING_PAGES', undefined);
    vi.stubEnv('XOMONI_E2E_DIGESTS', undefined);
    expect(sitemap().map(({ url }) => url)).toEqual([
      'https://xomoni.com',
      'https://xomoni.com/install',
      'https://xomoni.com/algorithm',
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
  });

  it('lists each published digest of X’s ranking code after the list of them, never a draft (#430)', () => {
    // The end-to-end tests' samples, shown on a local site only: 2000-02 and 2000-01 published, 2000-03 a draft.
    vi.stubEnv('XOMONI_E2E_DIGESTS', '1');
    const urls = sitemap().map(({ url }) => url);
    expect(urls.slice(2, 5)).toEqual([
      'https://xomoni.com/algorithm',
      'https://xomoni.com/algorithm/2000-02',
      'https://xomoni.com/algorithm/2000-01',
    ]);
    expect(urls).not.toContain('https://xomoni.com/algorithm/2000-03');
  });
});
