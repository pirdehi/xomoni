/**
 * HTTP security headers sent with every response from xomoni.com (#8, ADR-0014). Pure: `next.config.ts`
 * passes in the deployment's settings, so the policy can be checked in unit tests without Next.js.
 */

/** One response header, in the shape `headers()` in `next.config.ts` returns. */
export interface Header {
  key: string;
  value: string;
}

/** The deployment settings the policy depends on. */
export interface SecurityHeaderSettings {
  /** The Supabase project URL. The browser calls it over HTTP(S) and, for Realtime, over WebSockets. */
  supabaseUrl: string;
  /**
   * The site's public origin. Over plain HTTP (local runs and CI), insecure requests are not upgraded,
   * because that would break the page's own requests. Vercel preview deployments leave it unset; they are
   * always HTTPS.
   */
  siteUrl?: string;
  /** `next dev`: React needs `eval` for its error overlay, in development only. */
  dev: boolean;
}

/** Cloudflare Turnstile: its script and its widget frame on the auth forms. */
const TURNSTILE = 'https://challenges.cloudflare.com';
/** Profile pictures from Google sign-in, shown on the dashboard. */
const GOOGLE_AVATARS = 'https://*.googleusercontent.com';

/**
 * The Content-Security-Policy. Scripts may come only from the site and Turnstile, the browser may talk only
 * to the site and Supabase, nothing may frame the site, and forms may post only to it. Inline scripts stay
 * allowed: Next.js streams each page's data in inline scripts, and the nonce alternative would make every
 * page dynamic (ADR-0014).
 */
export function contentSecurityPolicy({ supabaseUrl, siteUrl, dev }: SecurityHeaderSettings): string {
  const supabase = new URL(supabaseUrl);
  const realtime = `${supabase.protocol === 'https:' ? 'wss:' : 'ws:'}//${supabase.host}`;
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", "'unsafe-inline'", TURNSTILE, ...(dev ? ["'unsafe-eval'"] : [])],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', GOOGLE_AVATARS],
    ['font-src', "'self'"],
    ['connect-src', "'self'", supabase.origin, realtime],
    ['frame-src', TURNSTILE],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  const policy = directives.map((directive) => directive.join(' '));
  if (!siteUrl?.startsWith('http:')) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/**
 * Every security header, for all paths. HSTS covers subdomains too: every xomoni.com host is served over
 * HTTPS. The site uses no camera, microphone, location, payment or USB, so pages can't ask for them.
 */
export function securityHeaders(settings: SecurityHeaderSettings): Header[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(settings) },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Only features browsers still know: an unknown one, like the retired `browsing-topics`, logs an error on every page.
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}
