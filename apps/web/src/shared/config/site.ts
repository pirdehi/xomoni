/** Public links and addresses used across the site. */

/** The public source repository. */
export const GITHUB_URL = 'https://github.com/pirdehi/xomoni';

/** Install instructions for the extension (README section). */
export const INSTALL_URL = `${GITHUB_URL}#install`;

/** Where people report bugs and ask questions. */
export const ISSUES_URL = `${GITHUB_URL}/issues`;

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
  throw new Error('Missing NEXT_PUBLIC_SITE_URL: copy apps/web/.env.example to apps/web/.env.local, or set it in Vercel.');
}
