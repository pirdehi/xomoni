// Runs in the page's own JavaScript world at document_start, before any of X's scripts.
// It observes the responses of GraphQL requests that X's web app makes itself,
// so the extension can read results and rate-limit headers. It never sends,
// alters or replays a request.
//
// Once X's scripts run, it uses only the built-ins taken at document_start (`natives.ts`), so a page script
// that patches a prototype later can't rewrite what is captured or reach the private port (#145). Only
// requests to x.com itself are captured, by the URL the request went to and the one the answer came from.
import { type Capture, takePort } from '../shared/bridge';
import { WATCHED_OPS, X_ORIGIN } from '../shared/x-operations';
import { natives as N } from './natives';

(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w.__xomoniNet) return;
  w.__xomoniNet = true;

  const OP = /^\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)$/;
  // X's rate-limit headers, and `date`: X's own clock, to correct the reset time for a skewed system clock (#31).
  const CAPTURED_HEADERS = ['x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset', 'date'];

  // Captures go only to the content script, through the private channel it hands over at document_start (#59).
  let port: MessagePort | null = null;
  takePort(document, (p) => (port = p));
  const emit = (capture: Capture) => {
    if (port) N.postMessage(port, capture);
  };

  /** `url` made absolute against x.com, with the watched operation it calls on x.com itself; null otherwise. */
  const watched = (url: string): { op: string; url: string } | null => {
    try {
      const parsed = new N.URL(url, X_ORIGIN);
      if (N.urlOrigin(parsed) !== X_ORIGIN) return null;
      const op = N.exec(OP, N.urlPathname(parsed))?.[1];
      return op && N.has(WATCHED_OPS, op) ? { op, url: N.urlHref(parsed) } : null;
    } catch {
      return null;
    }
  };

  /** Whether an answer came from x.com, by its final URL; an empty one (a response built in the page) counts as the request's. */
  const answeredByX = (finalUrl: string) => !finalUrl || watched(finalUrl) !== null;

  /** A null-prototype object of the captured headers, so no setter a page script added can intercept them. */
  const pickHeaders = (read: (name: string) => string | null) => {
    const headers = N.create(null);
    for (let i = 0; i < CAPTURED_HEADERS.length; i++) {
      const name = CAPTURED_HEADERS[i];
      if (name === undefined) continue;
      headers[name] = read(name);
    }
    return headers;
  };

  const nativeFetch = N.fetch;
  if (nativeFetch) wrapFetch(nativeFetch);
  const nativeOpen = N.xhrOpen;
  const nativeSend = N.xhrSend;
  if (nativeOpen && nativeSend) wrapXhr(nativeOpen, nativeSend);

  function wrapFetch(nativeFetch: typeof fetch) {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      let target: { op: string; url: string } | null = null;
      let method = 'GET';
      // The request body, once known; `waiting` counts the parts still to come (the body and the answer).
      let reqBody: string | null = null;
      let answer: { status: number; headers: Record<string, string | null>; body: string } | null = null;
      let waiting = 2;
      const part = () => {
        if (--waiting === 0 && target && answer) emit({ ...target, method, reqBody, ...answer });
      };
      try {
        const request = N.isRequest(input) ? input : null;
        const url =
          typeof input === 'string' ? input : request ? N.requestUrl(request) : N.isURL(input) ? N.urlHref(input) : '';
        target = watched(url);
        if (target) {
          const declared: unknown = init?.method;
          method = N.upper(declared != null ? N.String(declared) : request ? N.requestMethod(request) : 'GET');
          const body: unknown = init?.body;
          if (typeof body === 'string') {
            reqBody = body;
            part();
          } else if (body == null && request) {
            // The body may come inside a Request instead; read a copy before fetch uses the original.
            N.then(
              N.requestText(N.requestClone(request)),
              (text) => {
                reqBody = text;
                part();
              },
              () => part(),
            );
          } else part();
        }
      } catch {
        /* never interfere with the page */
        target = null;
      }
      const pending = N.apply(nativeFetch, window, [input, init]);
      try {
        if (target) {
          N.then(
            pending,
            (res) => {
              try {
                if (!answeredByX(N.responseUrl(res))) return;
                const status = N.responseStatus(res);
                const resHeaders = N.responseHeaders(res);
                const headers = pickHeaders((name) => N.headerGet(resHeaders, name));
                N.then(
                  N.responseText(N.responseClone(res)),
                  (body) => {
                    answer = { status, headers, body };
                    part();
                  },
                  () => {},
                );
              } catch {
                /* unreadable answer */
              }
            },
            () => {
              answer = { status: 0, headers: N.create(null), body: '' };
              part();
            },
          );
        }
      } catch {
        /* never interfere with the page */
      }
      return pending;
    };
  }

  // What `open` was called with, per request, kept where no page script can rewrite it.
  function wrapXhr(nativeOpen: XMLHttpRequest['open'], nativeSend: XMLHttpRequest['send']) {
    const opened = new N.WeakMap<XMLHttpRequest, { method: string; url: string }>();

    // X's own arguments are passed on untouched; they are typed `unknown` because the page may send anything.
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        N.weakSet(opened, this, { method: N.upper(N.String(args[0])), url: N.String(args[1]) });
      } catch {
        /* never interfere with the page */
      }
      N.apply(nativeOpen as (...a: unknown[]) => void, this, args);
    };

    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      try {
        const meta = N.weakGet(opened, this);
        if (meta && watched(meta.url)) {
          const reqBody = typeof body === 'string' ? body : null;
          N.addEventListener(this, 'loadend', () => {
            try {
              // The URL the answer came from, after any redirect; empty when there was no answer.
              const target = watched(N.xhrResponseURL(this) || meta.url);
              if (!target) return;
              let text = '';
              try {
                const type = N.xhrResponseType(this);
                text = type === '' || type === 'text' ? N.xhrResponseText(this) : N.stringify(N.xhrResponse(this));
              } catch {
                /* unreadable body */
              }
              const headers = pickHeaders((name) => N.xhrHeader(this, name));
              emit({ ...target, method: meta.method, status: N.xhrStatus(this), reqBody, headers, body: text });
            } catch {
              /* never interfere with the page */
            }
          });
        }
      } catch {
        /* never interfere with the page */
      }
      N.apply(nativeSend, this, [body]);
    };
  }
})();
