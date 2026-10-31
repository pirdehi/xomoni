import path from 'node:path';
import type { NextConfig } from 'next';
import { securityHeaders } from './src/shared/config/security-headers';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@xomoni/consent', '@xomoni/db'],
  // CSP, HSTS, framing and the rest, on every response (ADR-0014).
  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl)
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL: copy apps/web/.env.example to apps/web/.env.local, or set it in Vercel.',
      );
    const settings = {
      supabaseUrl,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
      dev: process.env.NODE_ENV === 'development',
    };
    return [{ source: '/:path*', headers: securityHeaders(settings) }];
  },
  turbopack: {
    // npm workspaces hoist dependencies to the monorepo root.
    root: path.join(__dirname, '..', '..'),
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
