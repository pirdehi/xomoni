/**
 * Public Supabase settings, read once at build time.
 * A missing value fails the build with a clear message instead of shipping a site that can't reach Supabase.
 */
function required(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(`Missing ${name}: copy apps/web/.env.example to apps/web/.env.local, or set it in Vercel.`);
  return value;
}

// Referenced literally so Next.js inlines them into the browser bundle.

/** The Supabase project URL (`https://<ref>.supabase.co`, or the local stack). */
export const SUPABASE_URL = required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);

/** The publishable (anon) key. Public by design: Row Level Security protects the data. */
export const SUPABASE_KEY = required(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/**
 * The session cookies' lifetime: 30 days instead of `@supabase/ssr`'s 400 (#148). Every token refresh writes them
 * again, so a browser left unused for 30 days is signed out. Supabase's own session limits need a paid plan.
 */
export const SESSION_COOKIE_OPTIONS = { maxAge: 30 * 24 * 60 * 60 } as const;
