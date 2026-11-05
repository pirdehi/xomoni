/**
 * Cross-site request checks for route handlers that change state (#147, ADR-0014). Server Actions get the same
 * check from Next.js; route handlers don't, and SameSite=Lax cookies alone still let another site's form post
 * to them in some browsers and through some redirects.
 */

/**
 * Whether `request` was sent by a page of the site itself. The `Origin` header must equal `siteOrigin`. A browser
 * that sends no `Origin` must say `Sec-Fetch-Site: same-origin` instead; anything else is refused, including a
 * request with neither header, which no current browser sends for a form post.
 */
export function isSameOriginRequest(request: Request, siteOrigin: string): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null) return origin === siteOrigin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/** The response to a refused cross-site request: 403, no body worth showing, never cached. */
export function crossSiteRefused(): Response {
  return new Response('Cross-site request refused.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
