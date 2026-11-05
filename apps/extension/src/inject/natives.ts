// The built-ins the page-world interceptor uses, taken once at document_start, before any of X's scripts run
// (#145). Each method is "uncurried": `responseText(res)` calls the original `Response.prototype.text` on `res`,
// whatever a later script assigns to the prototype, to `Function.prototype.call` or to the global names. That
// keeps a page script from rewriting what Xomoni captures, or from getting hold of its private port by patching
// `MessagePort.prototype.postMessage`. Values that come back are the browser's own, never the page's.
// Like `x-operations.ts`, this runs inside X's page, so it imports nothing.

const apply = Reflect.apply;
const descriptor = Object.getOwnPropertyDescriptor;

/** Any function, as `uncurry` takes one. */
type Method = (...args: never[]) => unknown;

/** `obj[key]` as the browser has it now, at document_start; undefined when `obj` is missing. */
function read<T extends object, K extends keyof T>(obj: T | undefined, key: K): T[K] | undefined {
  return obj?.[key];
}

/** `fn` as a function that takes its `this` first; calling it throws when the browser doesn't have `fn`. */
function uncurry<F extends Method>(fn: F | undefined): (self: unknown, ...args: Parameters<F>) => ReturnType<F> {
  return (self: unknown, ...args: Parameters<F>) => {
    if (typeof fn !== 'function') throw new TypeError('Xomoni: built-in missing');
    return apply(fn, self, args) as ReturnType<F>;
  };
}

/** A property descriptor's getter, typed as a property rather than a method, because it is taken off on purpose. */
interface GetterDescriptor {
  get?: (this: unknown) => unknown;
}

const getterOf = (d: GetterDescriptor | undefined) => d?.get;

/** The getter of `key` on `proto`, uncurried; calling it throws when the browser doesn't have it. */
function getter<T extends object, K extends keyof T>(proto: T | undefined, key: K): (self: unknown) => T[K] {
  const get = proto ? getterOf(descriptor(proto, key)) : undefined;
  return (self: unknown) => {
    if (!get) throw new TypeError('Xomoni: built-in missing');
    return apply(get, self, []) as T[K];
  };
}

/** Whether `value` is a real `T`, by whether the browser's own getter `check` accepts it (a brand check). */
function brand<T>(check: (self: T) => unknown): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    try {
      check(value as T);
      return true;
    } catch {
      return false;
    }
  };
}

const xhr = typeof XMLHttpRequest === 'function' ? XMLHttpRequest.prototype : undefined;
const responseProto = typeof Response === 'function' ? Response.prototype : undefined;
const requestProto = typeof Request === 'function' ? Request.prototype : undefined;
const requestUrl = getter(requestProto, 'url');
const urlHref = getter(URL.prototype, 'href');

/** The built-ins, as they were when the interceptor started. */
export const natives = {
  apply,
  /** `window.fetch` before the interceptor wraps it. */
  fetch: read(window, 'fetch'),
  URL,
  String,
  WeakMap,
  create: Object.create as (proto: null) => Record<string, string | null>,
  stringify: JSON.stringify,
  exec: uncurry(read(RegExp.prototype, 'exec')),
  has: uncurry(read(Set.prototype, 'has')) as (set: ReadonlySet<string>, value: string) => boolean,
  upper: uncurry(read(String.prototype, 'toUpperCase')),
  then: uncurry(read(Promise.prototype, 'then')) as <T>(
    promise: Promise<T>,
    onFulfilled: (value: T) => void,
    onRejected: (reason: unknown) => void,
  ) => unknown,
  weakGet: uncurry(read(WeakMap.prototype, 'get')) as <K extends object, V>(
    map: WeakMap<K, V>,
    key: K,
  ) => V | undefined,
  weakSet: uncurry(read(WeakMap.prototype, 'set')) as <K extends object, V>(
    map: WeakMap<K, V>,
    key: K,
    value: V,
  ) => unknown,
  postMessage: uncurry(read(MessagePort.prototype, 'postMessage')) as (port: MessagePort, message: unknown) => void,
  addEventListener: uncurry(read(EventTarget.prototype, 'addEventListener')) as (
    target: EventTarget,
    type: string,
    listener: () => void,
  ) => void,
  urlHref,
  urlOrigin: getter(URL.prototype, 'origin'),
  urlPathname: getter(URL.prototype, 'pathname'),
  isURL: brand<URL>(urlHref),
  isRequest: brand<Request>(requestUrl),
  requestUrl,
  requestMethod: getter(requestProto, 'method'),
  requestClone: uncurry(read(requestProto, 'clone')),
  requestText: uncurry(read(requestProto, 'text')),
  responseUrl: getter(responseProto, 'url'),
  responseStatus: getter(responseProto, 'status'),
  responseHeaders: getter(responseProto, 'headers'),
  responseClone: uncurry(read(responseProto, 'clone')),
  responseText: uncurry(read(responseProto, 'text')),
  headerGet: uncurry(read(typeof Headers === 'function' ? Headers.prototype : undefined, 'get')),
  xhrOpen: read(xhr, 'open'),
  xhrSend: read(xhr, 'send'),
  xhrStatus: getter(xhr, 'status'),
  xhrResponseURL: getter(xhr, 'responseURL'),
  xhrResponseType: getter(xhr, 'responseType'),
  xhrResponseText: getter(xhr, 'responseText'),
  xhrResponse: getter(xhr, 'response'),
  xhrHeader: uncurry(read(xhr, 'getResponseHeader')),
};
