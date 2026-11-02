/**
 * The private channel between the page-world interceptor and the content script (#59). Anything sent with
 * `window.postMessage` can be read and forged by every script on x.com, so captures travel through a
 * `MessageChannel` instead. The content script hands one port to the interceptor with a synchronous DOM event
 * while both start at `document_start`, before any of X's scripts run. Once handed over, nothing else on the
 * page can see the channel or post into it. Works the same whichever of the two scripts runs first.
 */

/** Dispatched on `document` by the content script: a `MessageEvent` carrying the interceptor's port. */
export const PORT_EVENT = 'xomoni:port';
/** Dispatched on `document` by the interceptor when it starts, in case it missed the content script's offer. */
export const ASK_EVENT = 'xomoni:ask';

/** One response to a GraphQL request X's own web app made, as the interceptor captured it. */
export interface Capture {
  /** GraphQL operation name from the URL, such as `DeleteTweet`. */
  op: string;
  url: string;
  method: string;
  /** HTTP status; 0 when the request got no answer. */
  status: number;
  /** The request body when it was a string, else null. */
  reqBody: string | null;
  /** Only the `x-rate-limit-*` headers and `date` (X's clock, for the skew correction). */
  headers: Record<string, string | null>;
  body: string;
}

/** The part of `document` the handover uses, so it can be tested on any `EventTarget`. */
type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>;

/**
 * Content-script side: offers `port` to the interceptor at once and, if nobody took it because the interceptor
 * hasn't started yet, once more when the interceptor asks. The interceptor asks only once, as it starts, so
 * the offer is never repeated for a script that asks later.
 */
export function offerPort(doc: Target, port: MessagePort) {
  const offer = () => !doc.dispatchEvent(new MessageEvent(PORT_EVENT, { ports: [port], cancelable: true }));
  if (!offer()) doc.addEventListener(ASK_EVENT, offer, { once: true });
}

/**
 * Interceptor side: takes the port the content script offers, now or right after asking for it, and calls
 * `onPort` once with it. Taking it cancels the event, which tells the content script it arrived.
 */
export function takePort(doc: Target, onPort: (port: MessagePort) => void) {
  const take = (event: Event) => {
    // Read the ports by shape, not with `instanceof`: the event crosses from the extension's world to the page's.
    const port = (event as Partial<MessageEvent>).ports?.[0];
    if (!port) return;
    event.preventDefault();
    doc.removeEventListener(PORT_EVENT, take);
    onPort(port);
  };
  doc.addEventListener(PORT_EVENT, take);
  doc.dispatchEvent(new Event(ASK_EVENT));
}

/** Whether `data` has exactly the shape of a `Capture`; anything else arriving on the channel is dropped. */
export function isCapture(data: unknown): data is Capture {
  if (!data || typeof data !== 'object') return false;
  const c = data as Record<string, unknown>;
  return (
    typeof c.op === 'string' &&
    typeof c.url === 'string' &&
    typeof c.method === 'string' &&
    typeof c.status === 'number' &&
    (c.reqBody === null || typeof c.reqBody === 'string') &&
    !!c.headers &&
    typeof c.headers === 'object' &&
    Object.values(c.headers).every((v) => v === null || typeof v === 'string') &&
    typeof c.body === 'string'
  );
}
