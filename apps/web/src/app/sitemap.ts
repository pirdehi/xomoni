import type { MetadataRoute } from 'next';
import { billingPagesOn } from '@/shared/config/billing-pages';

/** `sitemap.xml` for the public pages; the terms of sale and the refund policy only while they are shown (#420). */
export default function sitemap(): MetadataRoute.Sitemap {
  const billing = billingPagesOn() ? ['/terms-of-sale', '/refunds'] : [];
  return ['', '/install', '/risks', '/privacy', '/terms', ...billing, '/login', '/signup'].map((path) => ({
    url: `https://xomoni.com${path}`,
  }));
}
