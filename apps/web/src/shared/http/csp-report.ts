/**
 * Content-Security-Policy violation reports (#147, ADR-0014). Browsers post them to `CSP_REPORT_PATH`: as the
 * Reporting API's `application/reports+json` list, or as the older `application/csp-report` object. The handler
 * reads at most `MAX_REPORT_BYTES`, keeps a few fields of each report, and logs them, so a blocked script shows
 * up in the server logs.
 *
 * Reports come from anyone's browser, so nothing in them is trusted: URLs lose their query and fragment (reset
 * and sign-in links carry codes there), every field is cut short, and only `MAX_REPORTS` are logged per request.
 */

/** The largest report body read. A single violation report is about 1 KB; browsers batch a few. */
export const MAX_REPORT_BYTES = 32 * 1024;

/** The most reports logged from one request. */
export const MAX_REPORTS = 20;

/** The longest field kept from a report. */
const MAX_FIELD = 200;

/** Content types browsers use for violation reports. */
const REPORT_TYPES = ['application/reports+json', 'application/csp-report', 'application/json'];

/** One violation, as logged. */
export interface CspViolation {
  /** The directive that blocked something, such as `script-src-elem` or `require-trusted-types-for`. */
  directive: string;
  /** What was blocked: a URL without query, or a keyword such as `inline`, `eval` or `trusted-types-sink`. */
  blocked: string;
  /** The page it happened on, without query. */
  page: string;
  /** `enforce` or `report`. */
  disposition: string;
  /** The first characters of the blocked code, when the browser sent them. */
  sample: string;
}

/**
 * `value` as a short loggable string: URLs without query and fragment, anything else as is, both cut at
 * `MAX_FIELD`. Non-strings become empty.
 */
function field(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = `${url.origin}${url.pathname}`;
    } catch {
      text = text.split(/[?#]/)[0] ?? '';
    }
  }
  return text.slice(0, MAX_FIELD);
}

/** The fields of one report body, whichever format it came in. */
function violation(body: Record<string, unknown>): CspViolation {
  return {
    directive: field(body.effectiveDirective ?? body['effective-directive'] ?? body['violated-directive']),
    blocked: field(body.blockedURL ?? body['blocked-uri']),
    page: field(body.documentURL ?? body['document-uri']),
    disposition: field(body.disposition),
    sample: field(body.sample ?? body['script-sample']),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The violations in a parsed report body: a Reporting API list (only its `csp-violation` entries) or a
 * `{"csp-report": …}` object. Anything else holds none. At most `MAX_REPORTS`.
 */
export function cspViolations(payload: unknown): CspViolation[] {
  const bodies: Record<string, unknown>[] = [];
  if (Array.isArray(payload)) {
    for (const report of payload as unknown[])
      if (isObject(report) && report.type === 'csp-violation' && isObject(report.body)) bodies.push(report.body);
  } else if (isObject(payload) && isObject(payload['csp-report'])) {
    bodies.push(payload['csp-report']);
  }
  return bodies.slice(0, MAX_REPORTS).map(violation);
}

/** The request body as text, or null when it is longer than `limit` bytes. Stops reading at the limit. */
export async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? NaN);
  if (declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * `POST /api/csp-report`: logs the violations a browser reports and answers 204. Refuses a body over
 * `MAX_REPORT_BYTES` (413), another content type (415) and malformed JSON (400). It changes nothing, so it
 * needs no Origin check.
 */
export async function handleCspReport(request: Request): Promise<Response> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!REPORT_TYPES.includes(type)) return new Response(null, { status: 415 });
  const text = await readLimited(request, MAX_REPORT_BYTES);
  if (text === null) return new Response(null, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  for (const report of cspViolations(payload)) console.warn('csp violation', JSON.stringify(report));
  return new Response(null, { status: 204 });
}
