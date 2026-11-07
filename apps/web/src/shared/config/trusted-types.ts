/**
 * Trusted Types on xomoni.com (#147, ADR-0014). The Content-Security-Policy requires Trusted Types for every
 * script sink (`innerHTML`, `script.src`, `eval` and the rest), and allows one policy only: `default`, which
 * `instrumentation-client.ts` installs before React hydrates the page.
 *
 * The default policy is what the browser calls when a string reaches a sink. Two kinds of code need it:
 * - Turbopack's runtime loads the site's own bundles by setting `script.src` to a string.
 * - Cloudflare Turnstile's React wrapper adds Turnstile's loader the same way.
 *
 * An allowed URL is passed on exactly as given: Turbopack finds a loaded bundle again by its `src` attribute, so a
 * relative path made absolute would leave a navigation waiting forever.
 *
 * Anything else is refused, and the browser reports it (`report-to`). HTML is let through only when it can't
 * create an element: text without `<`, as in the style text of Next.js's error page. Script text (`eval`,
 * `script.text`) is always refused.
 */

/** The only policy name the Content-Security-Policy allows (`trusted-types default`). */
export const TRUSTED_TYPES_POLICY = 'default';

/** Where the site's own JavaScript bundles live: `script.src` may point there. */
export const SITE_BUNDLES = '/_next/static/';

/** Cloudflare Turnstile's loader for the auth forms: `script.src` may point there too. */
export const TURNSTILE_LOADER = 'https://challenges.cloudflare.com/turnstile/v0/';

/** The rules of the default policy, in the shape `trustedTypes.createPolicy` takes. */
export interface TrustedTypesRules {
  createScriptURL(value: string): string | null;
  createHTML(value: string): string | null;
}

/** The part of `window` the policy needs; tests pass a fake. */
export interface TrustedTypesHost {
  trustedTypes?: { createPolicy(name: string, rules: TrustedTypesRules): unknown; defaultPolicy?: unknown } | null;
  location: { origin: string };
  document: { baseURI: string };
}

/** The default policy's rules for a page on `origin` whose relative URLs resolve against `baseURI()`. */
export function trustedTypesRules(origin: string, baseURI: () => string): TrustedTypesRules {
  return {
    createScriptURL(value) {
      let url: URL;
      try {
        url = new URL(value, baseURI());
      } catch {
        return null;
      }
      if (url.origin === origin && url.pathname.startsWith(SITE_BUNDLES)) return value;
      if (url.href.startsWith(TURNSTILE_LOADER)) return value;
      return null;
    },
    createHTML(value) {
      return value.includes('<') ? null : value;
    },
  };
}

/**
 * Creates the site's default Trusted Types policy on `host`, and says whether it is the one in place. Does nothing
 * in a browser without Trusted Types.
 *
 * A browser allows one `default` policy, and an extension that runs in the page before its scripts may have made
 * it already. Then that one stays in charge and the page carries on with a warning: throwing here stopped React
 * before it rendered anything, which left the sign-in page without its form (#178).
 */
export function installTrustedTypesPolicy(host: TrustedTypesHost): boolean {
  const trustedTypes = host.trustedTypes;
  if (!trustedTypes || typeof trustedTypes.createPolicy !== 'function') return false;
  // Asked first: even a failed attempt to make a second default policy is reported as a CSP violation.
  if (trustedTypes.defaultPolicy) {
    console.warn('Xomoni: another default Trusted Types policy is in place, probably from a browser extension.');
    return false;
  }
  try {
    trustedTypes.createPolicy(
      TRUSTED_TYPES_POLICY,
      trustedTypesRules(host.location.origin, () => host.document.baseURI),
    );
    return true;
  } catch (err) {
    console.warn('Xomoni: another default Trusted Types policy is in place, probably from a browser extension.', err);
    return false;
  }
}
