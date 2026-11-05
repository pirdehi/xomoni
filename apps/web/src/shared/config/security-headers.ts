/**
 * HTTP security headers sent with every response from xomoni.com (#8, #147, ADR-0014). Pure: `next.config.ts`
 * passes in the deployment's settings, so the policy can be checked in unit tests without Next.js.
 */
import { TRUSTED_TYPES_POLICY } from './trusted-types';

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
/** Profile pictures from Google sign-in, shown on the dashboard. `viewerFromClaims` keeps no other avatar host. */
export const GOOGLE_AVATARS = 'https://lh3.googleusercontent.com';

/** Where browsers send Content-Security-Policy violation reports (`app/api/csp-report/route.ts`). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** The `Reporting-Endpoints` name the policy's `report-to` refers to. */
export const CSP_REPORT_GROUP = 'csp';

/**
 * Files other sites may embed despite `Cross-Origin-Resource-Policy: same-origin`: the logo in Supabase's auth
 * emails (`supabase/templates/`), which mail apps load from their own pages.
 */
export const EMBEDDABLE_PATHS = ['/logo.png'] as const;

/**
 * The Content-Security-Policy. Scripts may come only from the site and Turnstile, the browser may talk only
 * to the site and Supabase, nothing may frame the site, and forms may post only to it. Inline scripts stay
 * allowed: Next.js streams each page's data in inline scripts, and the nonce alternative would make every
 * page dynamic (ADR-0014).
 *
 * Outside development, script sinks such as `innerHTML` and `script.src` take only Trusted Types values, made by
 * the site's one `default` policy (`trusted-types.ts`); `next dev` needs `eval`, which that policy refuses.
 * Violations are reported to `CSP_REPORT_PATH`: `report-to` for browsers with the Reporting API, `report-uri`
 * for the rest.
 */
export function contentSecurityPolicy({ supabaseUrl, siteUrl, dev }: SecurityHeaderSettings): string {
  const supabase = new URL(supabaseUrl);
  const realtime = `${supabase.protocol === 'https:' ? 'wss:' : 'ws:'}//${supabase.host}`;
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", "'unsafe-inline'", TURNSTILE, ...(dev ? ["'unsafe-eval'"] : [])],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', GOOGLE_AVATARS],
    ['font-src', "'self'"],
    ['connect-src', "'self'", supabase.origin, realtime],
    ['frame-src', TURNSTILE],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ...(dev
      ? []
      : ([
          ['require-trusted-types-for', "'script'"],
          ['trusted-types', TRUSTED_TYPES_POLICY],
        ] as [string, ...string[]][])),
    ['report-uri', CSP_REPORT_PATH],
    ['report-to', CSP_REPORT_GROUP],
  ];
  const policy = directives.map((directive) => directive.join(' '));
  if (!siteUrl?.startsWith('http:')) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/**
 * Every security header, for all paths. HSTS covers subdomains too: every xomoni.com host is served over
 * HTTPS. The site uses no camera, microphone, location, payment or USB, so pages can't ask for them. No other
 * site may load its responses as images, scripts or frames (`Cross-Origin-Resource-Policy`), except
 * `EMBEDDABLE_PATHS` (`embeddableHeaders`).
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
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    // A relative endpoint, so previews and local runs report to themselves.
    { key: 'Reporting-Endpoints', value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
  ];
}

/** The headers that replace `securityHeaders`' for `EMBEDDABLE_PATHS`, which other sites may load. */
export function embeddableHeaders(): Header[] {
  return [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }];
}
