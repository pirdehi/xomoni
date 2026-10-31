// Runs in the page's own JavaScript world at document_start.
// It observes the responses of GraphQL requests that X's web app makes itself,
// so the extension can read results and rate-limit headers. It never sends,
// alters or replays a request.
(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w.__xomoniNet) return;
  w.__xomoniNet = true;

  const OP = /\/i\/api\/graphql\/[^/?]+\/([A-Za-z]+)/;
  const WATCHED = new Set([
    'UserTweets',
    'UserTweetsAndReplies',
    'Likes',
    'SearchTimeline',
    'TweetDetail',
    'UserByScreenName',
    'DeleteTweet',
    'DeleteRetweet',
    'FavoriteTweet',
    'UnfavoriteTweet',
  ]);
  const RATE_HEADERS = ['x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset'];

  interface Capture {
    op: string;
    url: string;
    method: string;
    status: number;
    reqBody: string | null;
    headers: Record<string, string | null>;
    body: string;
  }

  const emit = (capture: Capture) => window.postMessage({ source: 'xomoni-net', ...capture }, location.origin);
  const watchedOp = (url: string) => {
    const op = url.match(OP)?.[1];
    return op && WATCHED.has(op) ? op : null;
  };

  const nativeFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    let op: string | null = null;
    let url = '';
    let reqBody: Promise<string | null> = Promise.resolve(null);
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      op = watchedOp(url);
      if (op && typeof init?.body === 'string') reqBody = Promise.resolve(init.body);
      // The body may come inside a Request instead; read a copy before fetch uses the original.
      else if (op && init?.body == null && input instanceof Request)
        reqBody = input
          .clone()
          .text()
          .catch(() => null);
    } catch {
      /* never interfere with the page */
    }
    const pending = nativeFetch.call(window, input, init);
    try {
      if (op) {
        const watched = op;
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        pending.then(
          (res) => {
            const headers = Object.fromEntries(RATE_HEADERS.map((h) => [h, res.headers.get(h)]));
            Promise.all([reqBody, res.clone().text()])
              .then(([req, body]) =>
                emit({ op: watched, url, method, status: res.status, reqBody: req, headers, body }),
              )
              .catch(() => {});
          },
          () =>
            reqBody.then((req) => emit({ op: watched, url, method, status: 0, reqBody: req, headers: {}, body: '' })),
        );
      }
    } catch {
      /* never interfere with the page */
    }
    return pending;
  };

  type TrackedXhr = XMLHttpRequest & { __xomoni?: { method: string; url: string } };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: TrackedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    this.__xomoni = { method: String(method).toUpperCase(), url: String(url) };
    return (nativeOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (this: TrackedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const meta = this.__xomoni;
      const op = meta ? watchedOp(meta.url) : null;
      if (meta && op) {
        const reqBody = typeof body === 'string' ? body : null;
        this.addEventListener('loadend', () => {
          let text = '';
          try {
            text =
              this.responseType === '' || this.responseType === 'text'
                ? this.responseText
                : JSON.stringify(this.response);
          } catch {
            /* unreadable body */
          }
          const headers: Record<string, string | null> = {};
          for (const h of RATE_HEADERS) headers[h] = this.getResponseHeader(h);
          emit({ op, url: meta.url, method: meta.method, status: this.status, reqBody, headers, body: text });
        });
      }
    } catch {
      /* never interfere with the page */
    }
    return nativeSend.call(this, body);
  };
})();
