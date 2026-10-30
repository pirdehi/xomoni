import type { MetadataRoute } from 'next';

/** `robots.txt`: everything public is crawlable except the signed-in areas. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/dashboard', '/auth/'] },
    sitemap: 'https://xomoni.com/sitemap.xml',
  };
}
