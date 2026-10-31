import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@xomoni/consent', '@xomoni/db'],
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
