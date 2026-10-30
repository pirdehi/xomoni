import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/privacy', '/terms', '/login'].map((path) => ({ url: `https://xomoni.com${path}` }));
}
