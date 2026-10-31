import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_EVENT, type Capture, PORT_EVENT, isCapture, offerPort, takePort } from '../src/shared/bridge';

const CAPTURE: Capture = {
  op: 'DeleteTweet',
  url: 'https://x.com/i/api/graphql/abc/DeleteTweet',
  method: 'POST',
  status: 200,
  reqBody: '{"variables":{"tweet_id":"1"}}',
  headers: { 'x-rate-limit-remaining': '49' },
  body: '{"data":{}}',
};

const channels: MessageChannel[] = [];
const newChannel = () => {
  const channel = new MessageChannel();
  channels.push(channel);
  return channel;
};

afterEach(() => {
  channels.splice(0).forEach((c) => {
    c.port1.close();
    c.port2.close();
  });
});

describe('the private channel between the interceptor and the content script (#59)', () => {
  it.each(['content script', 'interceptor'])('connects when the %s starts first', async (first) => {
    const doc = new EventTarget();
    const channel = newChannel();
    const onPort = vi.fn((port: MessagePort) => port.postMessage(CAPTURE));
    const received = new Promise((resolve) => (channel.port1.onmessage = (e) => resolve(e.data)));
    if (first === 'content script') {
      offerPort(doc, channel.port2);
      takePort(doc, onPort);
    } else {
      takePort(doc, onPort);
      offerPort(doc, channel.port2);
    }
    expect(onPort).toHaveBeenCalledOnce();
    expect(await received).toEqual(CAPTURE);
  });

  it('gives the port to nothing that asks after the handover', () => {
    const doc = new EventTarget();
    offerPort(doc, newChannel().port2);
    takePort(doc, () => {});
    // A page script that runs later asks too, and listens for the offer.
    const thief = vi.fn();
    doc.addEventListener(PORT_EVENT, thief);
    doc.dispatchEvent(new Event(ASK_EVENT));
    expect(thief).not.toHaveBeenCalled();
  });

  it('accepts only the exact shape of a capture', () => {
    expect(isCapture(CAPTURE)).toBe(true);
    expect(isCapture({ ...CAPTURE, reqBody: null })).toBe(true);
    expect(isCapture({ ...CAPTURE, status: '200' })).toBe(false);
    expect(isCapture({ ...CAPTURE, headers: { x: 1 } })).toBe(false);
    expect(isCapture({ source: 'xomoni-net', op: 'DeleteTweet' })).toBe(false);
    expect(isCapture(null)).toBe(false);
  });
});
