import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Natives from '../src/inject/natives';

let N: typeof Natives.natives;
const pageFetch = vi.fn();

beforeAll(async () => {
  // The interceptor runs in X's page; here only `window.fetch` and the language built-ins are needed.
  vi.stubGlobal('window', { fetch: pageFetch });
  ({ natives: N } = await import('../src/inject/natives'));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Replaces `proto[key]` for the length of `run`, as a page script would, then puts it back. */
function patched<T>(proto: object, key: string, value: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(proto, key)!;
  Object.defineProperty(proto, key, { ...original, value });
  try {
    return run();
  } finally {
    Object.defineProperty(proto, key, original);
  }
}

describe('the built-ins the interceptor took at document_start (#145)', () => {
  it('keeps window.fetch as it was before the page could replace it', () => {
    expect(N.fetch).toBe(pageFetch);
  });

  it('calls the original methods, whatever a page script assigns later', () => {
    const forged = () => ['forged', 'forged'];
    expect(patched(RegExp.prototype, 'exec', forged, () => N.exec(/a(b)/, 'ab')?.[1])).toBe('b');
    expect(
      patched(
        String.prototype,
        'toUpperCase',
        () => 'FORGED',
        () => N.upper('post'),
      ),
    ).toBe('POST');
    expect(
      patched(
        Set.prototype,
        'has',
        () => true,
        () => N.has(new Set(['Likes']), 'Follow'),
      ),
    ).toBe(false);
    expect(
      patched(
        Headers.prototype,
        'get',
        () => '0',
        () => N.headerGet(new Headers({ a: '1' }), 'a'),
      ),
    ).toBe('1');
  });

  it('reads getters from the browser’s own descriptors', () => {
    const response = new Response('{}', { status: 418 });
    const status = Object.getOwnPropertyDescriptor(Response.prototype, 'status')!;
    Object.defineProperty(Response.prototype, 'status', { ...status, get: () => 200 });
    try {
      expect(N.responseStatus(response)).toBe(418);
    } finally {
      Object.defineProperty(Response.prototype, 'status', status);
    }
    expect(N.urlOrigin(new URL('https://x.com/i/api/graphql/a/Likes?x=1'))).toBe('https://x.com');
    expect(N.urlPathname(new URL('https://x.com/i/api/graphql/a/Likes?x=1'))).toBe('/i/api/graphql/a/Likes');
  });

  it('tells real requests and URLs from look-alikes', () => {
    expect(N.isRequest(new Request('https://x.com/'))).toBe(true);
    expect(N.isRequest({ url: 'https://x.com/', method: 'GET' })).toBe(false);
    expect(N.isURL(new URL('https://x.com/'))).toBe(true);
    expect(N.isURL({ href: 'https://x.com/' })).toBe(false);
  });

  it('says so when the browser lacks a built-in, instead of calling whatever is there', () => {
    // There is no XMLHttpRequest outside a browser.
    expect(N.xhrOpen).toBeUndefined();
    expect(() => N.xhrStatus({})).toThrow('built-in missing');
    expect(() => N.xhrHeader({}, 'date')).toThrow('built-in missing');
  });
});
