import { handleProductDocument } from '@/modules/product-docs/server/document';

/**
 * `/product`: the product document, for super-admins only (ADR-0048). Its Content-Security-Policy, which sandboxes
 * the page, is set for this path in `next.config.ts`.
 */
export function GET(request: Request): Promise<Response> {
  return handleProductDocument(request);
}
