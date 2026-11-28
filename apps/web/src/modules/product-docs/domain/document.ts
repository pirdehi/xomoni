/** One stored version of a private product document: what lists and headers show, without the page itself. */
export interface ProductDocumentVersion {
  /** The version's id; versions are only ever added, never changed. */
  readonly id: number;
  /** Which document this is a version of, e.g. `product` for xomoni.com/product. */
  readonly slug: string;
  /** The title shown above the document and in its version list. */
  readonly title: string;
  /** When this version was stored (ISO 8601). */
  readonly createdAt: string;
}

/** A stored version together with the HTML page it carries. */
export interface ProductDocument extends ProductDocumentVersion {
  /** The whole page, with its own styles and scripts; served sandboxed, with its own Content-Security-Policy. */
  readonly html: string;
}

/** The document xomoni.com/product shows. */
export const PRODUCT_DOCUMENT_SLUG = 'product';

/**
 * The largest page that may be stored, in bytes. The database refuses anything over 1,000,000; this leaves room for
 * the request around it.
 */
export const MAX_DOCUMENT_BYTES = 900_000;

/** The longest title, in characters; the database refuses anything longer too. */
export const MAX_TITLE_LENGTH = 200;

/** Why an uploaded document was refused before it reached the store. */
export type DocumentProblem = 'bad-title' | 'empty' | 'too-large' | 'not-html';

/** Why adding a version failed: the document itself, a person who isn't a super-admin, or the store. */
export type AddProblem = DocumentProblem | 'forbidden' | 'failed';

/** The words a person sees for each {@link AddProblem}. */
export const ADD_PROBLEM_MESSAGES: Readonly<Record<AddProblem, string>> = {
  'bad-title': 'Give the version a title of up to 200 characters.',
  empty: 'The file is empty.',
  'too-large': 'The file is larger than 900 KB.',
  'not-html': 'Choose an HTML page: the file has no <html> or <body> tag.',
  forbidden: 'Only a super-admin can add a version.',
  failed: 'The version wasn’t saved. Try again.',
};

/**
 * Checks a document before it is stored: a title of 1 to {@link MAX_TITLE_LENGTH} characters and a page
 * that is HTML (it has an `<html` or `<body` tag) of at most {@link MAX_DOCUMENT_BYTES} bytes.
 * Returns null when it may be stored.
 */
export function checkDocument(input: { readonly title: string; readonly html: string }): DocumentProblem | null {
  const title = input.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) return 'bad-title';
  if (input.html.trim().length === 0) return 'empty';
  if (new TextEncoder().encode(input.html).length > MAX_DOCUMENT_BYTES) return 'too-large';
  if (!/<(html|body)[\s>]/i.test(input.html)) return 'not-html';
  return null;
}

/**
 * A small script added to every served document: links to other sites open in a new tab, because the
 * sandboxed frame may not navigate itself or the page around it. Links inside the document (`#section`)
 * keep working in place.
 */
export const LINK_SCRIPT =
  '<script>document.addEventListener("click",function(e){var a=e.target instanceof Element?e.target.closest("a[href]"):null;if(a&&/^https?:/i.test(a.getAttribute("href")||"")){a.target="_blank";a.rel="noopener noreferrer";}},true);</script>';

/** Where a super-admin uploads a new version and opens an older one. */
export const MANAGE_PATH = '/product/manage';

/**
 * A small fixed link to {@link MANAGE_PATH}, added to every served document, in the page's lower left corner. It
 * styles itself inline so the document's own styles can't hide it.
 */
export const MANAGE_LINK = `<a href="${MANAGE_PATH}" style="position:fixed;left:12px;bottom:12px;z-index:2147483647;font:600 12px/1.6 system-ui,sans-serif;padding:4px 10px;border-radius:999px;background:#0e2440;color:#e9f0f8;text-decoration:none;opacity:.85">Versions</a>`;

/**
 * The page as served: a doctype when it has none (so it never renders in quirks mode), then {@link MANAGE_LINK} and
 * {@link LINK_SCRIPT} just before the last `</body>`, or at the end when there is no `</body>`.
 */
export function prepareDocumentHtml(html: string): string {
  const withDoctype = /^\s*<!doctype html/i.test(html) ? html : `<!doctype html>\n${html}`;
  const added = `${MANAGE_LINK}\n${LINK_SCRIPT}\n`;
  const close = withDoctype.search(/<\/body>(?![\s\S]*<\/body>)/i);
  if (close === -1) return `${withDoctype}\n${added}`;
  return `${withDoctype.slice(0, close)}${added}${withDoctype.slice(close)}`;
}
