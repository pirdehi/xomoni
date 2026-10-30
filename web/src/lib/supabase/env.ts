// Fail the build with a clear message instead of shipping a site that can't reach Supabase.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}: copy web/.env.example to web/.env.local, or set it in Vercel.`);
  return value;
}

// Referenced literally so Next.js inlines them into the browser bundle.
export const SUPABASE_URL = required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_KEY = required(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
