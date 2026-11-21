/** Public links and addresses used across the site. */

/** The public source repository. */
export const GITHUB_URL = 'https://github.com/pirdehi/xomoni';

/** The install guide on this site (#44). */
export const INSTALL_URL = '/install';

/** Every release of the extension, with its checksums (docs/RELEASING.md). */
export const RELEASES_URL = `${GITHUB_URL}/releases`;

/** The newest release's zip: every release attaches it under this same name, so this link always serves the latest. */
export const DOWNLOAD_URL = `${RELEASES_URL}/latest/download/xomoni-extension.zip`;

/** Where people report bugs and ask questions. */
export const ISSUES_URL = `${GITHUB_URL}/issues`;

/** How to report a vulnerability: the repository's security policy (SECURITY.md). */
export const SECURITY_URL = `${GITHUB_URL}/security/policy`;

/** The privacy and support contact; forwarded by Cloudflare Email Routing. */
export const CONTACT_EMAIL = 'privacy@xomoni.com';

/**
 * Public origin of this deployment, such as `https://xomoni.com` or `http://localhost:3000`.
 * Used to build OAuth return URLs. Preview deployments fall back to their Vercel URL.
 */
export const SITE_URL = resolveSiteUrl();

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const preview = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (preview) return `https://${preview}`;
  throw new Error(
    'Missing NEXT_PUBLIC_SITE_URL: copy apps/web/.env.example to apps/web/.env.local, or set it in Vercel.',
  );
}

/**
 * End-to-end tests only (#302): the id of the test extension Playwright loads with a fixed `key`
 * (`e2e/fixtures/fixed-id-extension`), which the site then asks for Xomoni after the stores' ids. Taken only while the
 * site runs on localhost, so no deployment of xomoni.com can be set to ask another extension; null otherwise.
 */
export const TEST_EXTENSION_ID = testExtensionId(process.env.NEXT_PUBLIC_XOMONI_TEST_EXTENSION_ID, SITE_URL);

/** `TEST_EXTENSION_ID`'s rule: `raw` when it is set and `siteUrl` is on `localhost` or `127.0.0.1`, null otherwise. */
export function testExtensionId(raw: string | undefined, siteUrl: string): string | null {
  if (!raw) return null;
  const { hostname } = new URL(siteUrl);
  return hostname === 'localhost' || hostname === '127.0.0.1' ? raw : null;
}

/**
 * Cloudflare Turnstile site key for the sign-in, sign-up and password forms. Public by design.
 * Locally and in CI it is Cloudflare's always-pass test key, matching the test secret in supabase/config.toml.
 */
export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || missing('NEXT_PUBLIC_TURNSTILE_SITE_KEY');

function missing(name: string): never {
  throw new Error(`Missing ${name}: copy apps/web/.env.example to apps/web/.env.local, or set it in Vercel.`);
}
