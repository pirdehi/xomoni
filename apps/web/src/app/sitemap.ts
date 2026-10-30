import type { MetadataRoute } from 'next';

/** `sitemap.xml` for the public pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/privacy', '/terms', '/login', '/signup'].map((path) => ({ url: `https://xomoni.com${path}` }));
}
