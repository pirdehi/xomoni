import type { MetadataRoute } from 'next';
import { digestList } from '@/modules/algorithm/server/digests';
import { billingPagesOn } from '@/shared/config/billing-pages';

/**
 * `sitemap.xml` for the public pages: each published digest of X's ranking code (#430), and the terms of sale and the
 * refund policy only while they are shown (#420).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const digests = digestList().map((digest) => `/algorithm/${digest.month}`);
  const billing = billingPagesOn() ? ['/terms-of-sale', '/refunds'] : [];
  return [
    '',
    '/install',
    '/algorithm',
    ...digests,
    '/risks',
    '/privacy',
    '/terms',
    ...billing,
    '/login',
    '/signup',
  ].map((path) => ({ url: `https://xomoni.com${path}` }));
}
