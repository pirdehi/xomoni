// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Net from '../src/content/net';
import { takePort } from '../src/shared/bridge';

const { handleCapture } = vi.hoisted(() => ({ handleCapture: vi.fn() }));
vi.mock('../src/content/net', async (importOriginal) => ({ ...(await importOriginal<typeof Net>()), handleCapture }));

const CAPTURE = {
  op: 'DeleteTweet',
  url: 'https://x.com/i/api/graphql/abc/DeleteTweet',
  method: 'POST',
  status: 200,
  reqBody: '{"variables":{"tweet_id":"1"}}',
  headers: {},
  body: '{"data":{"delete_tweet":{}}}',
};

let port: MessagePort | undefined;

beforeAll(async () => {
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: () => {} } } });
  await import('../src/content/content');
  // The interceptor's side, as it starts in X's page.
  takePort(document, (p) => (port = p));
});

afterAll(() => {
  port?.close();
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('content script: only the private channel is trusted (#59)', () => {
  it('ignores a forged capture posted on the window by another script', async () => {
    // Exactly what the old window-message bridge trusted: same source window, the xomoni-net shape.
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'xomoni-net', ...CAPTURE }, source: window }));
    await settle();
    expect(handleCapture).not.toHaveBeenCalled();
  });

  it('handles a capture from the interceptor, and drops malformed data on the channel', async () => {
    port!.postMessage({ ...CAPTURE, status: 'ok' });
    port!.postMessage(CAPTURE);
    await vi.waitFor(() => expect(handleCapture).toHaveBeenCalledOnce());
    expect(handleCapture).toHaveBeenCalledWith(CAPTURE);
  });
});
