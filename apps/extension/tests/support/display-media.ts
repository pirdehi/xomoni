import { onTestFinished, vi } from 'vitest';

/** A fake shared video track: `end()` acts as Chrome's "Stop sharing" or the shared tab closing. */
export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => { displaySurface?: string };
  addEventListener: (type: string, listener: () => void) => void;
  end: () => void;
}

/** A fake `MediaStream` from `getDisplayMedia`, sharing a `surface` (`browser` is a tab). */
export function fakeStream(surface = 'browser') {
  const listeners: (() => void)[] = [];
  const track: FakeTrack = {
    stop: vi.fn(),
    getSettings: () => ({ displaySurface: surface }),
    addEventListener: (type, listener) => {
      if (type === 'ended') listeners.push(listener);
    },
    end: () => listeners.splice(0).forEach((l) => l()),
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

/** Puts `mediaDevices` on the test's `navigator`, as its own property, until the test finishes. */
export function stubMediaDevices(mediaDevices: object) {
  const nav = globalThis.navigator as object;
  const before = Object.getOwnPropertyDescriptor(nav, 'mediaDevices');
  Object.defineProperty(nav, 'mediaDevices', { value: mediaDevices, configurable: true });
  onTestFinished(() => {
    if (before) Object.defineProperty(nav, 'mediaDevices', before);
    else Reflect.deleteProperty(nav, 'mediaDevices');
  });
}

/** Stubs `navigator.mediaDevices.getDisplayMedia` to answer with `answer` (a stream, or an error to reject with). */
export function stubDisplayMedia(answer: MediaStream | Error) {
  const getDisplayMedia = vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
  stubMediaDevices({ getDisplayMedia });
  return getDisplayMedia;
}

/** The error Chrome rejects with when the person closes its picker. */
export const refusal = () => Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
