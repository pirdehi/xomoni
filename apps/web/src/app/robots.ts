import type { MetadataRoute } from 'next';

/** `robots.txt`: everything public is crawlable except signed-in areas and auth links. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/dashboard', '/account', '/reset-password', '/auth/'] },
    sitemap: 'https://xomoni.com/sitemap.xml',
  };
}
