// Where the extension reports job status (ADR-0018). These are public values: the website ships the same
// URL and publishable key in its own pages. The key only allows calling the functions ADR-0018 grants to
// `anon`; it can't read any table.

/** The Supabase project behind xomoni.com. */
export const CLOUD_URL = 'https://ueegjwwmuuxlxyibgokx.supabase.co';

/** Its publishable key, sent as `apikey`. */
export const CLOUD_KEY = 'sb_publishable_e03FK6TVz3bW--z9sH8FUg_ac9NCVaL';

/** Where the person gets a pairing code: the dashboard, after signing in. */
export const PAIRING_PAGE = 'https://xomoni.com/dashboard';
