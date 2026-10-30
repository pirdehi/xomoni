import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests for domain rules, use cases and adapter mappers. They run in Node without Supabase or Next.js.
export default defineConfig({
  resolve: { alias: { '@': path.join(__dirname, 'src') } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
