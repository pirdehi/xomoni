import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHARE_OPTIONS, TabShare } from '../src/ui/tab-share';
import { fakeStream, refusal, stubDisplayMedia, stubMediaDevices } from './support/display-media';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TabShare.start (Run hidden, #140)', () => {
  it('shares a tab and tells its subscribers', async () => {
    const { stream } = fakeStream();
    const getDisplayMedia = stubDisplayMedia(stream);
    const share = new TabShare();
    const listener = vi.fn();
    share.subscribe(listener);

    expect(await share.start()).toBe('sharing');
    expect(share.sharing()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getDisplayMedia).toHaveBeenCalledWith(SHARE_OPTIONS);
  });

  it('offers only tabs, never the dashboard itself or a screen, and captures no audio and almost no video', () => {
    expect(SHARE_OPTIONS).toMatchObject({
      audio: false,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      systemAudio: 'exclude',
      monitorTypeSurfaces: 'exclude',
      video: { displaySurface: 'browser', frameRate: { max: 1 }, width: { max: 64 }, height: { max: 64 } },
    });
  });

  it('stops a window or screen at once: only a shared tab is drawn while hidden', async () => {
    const { stream, track } = fakeStream('window');
    stubDisplayMedia(stream);
    const share = new TabShare();

    expect(await share.start()).toBe('not-a-tab');
    expect(track.stop).toHaveBeenCalled();
    expect(share.sharing()).toBe(false);
  });

  it('says cancelled when the person closes the picker', async () => {
    stubDisplayMedia(refusal());
    const share = new TabShare();
    expect(await share.start()).toBe('cancelled');
    expect(share.sharing()).toBe(false);
  });

  it('rethrows any other error', async () => {
    stubDisplayMedia(Object.assign(new Error('Document is not focused'), { name: 'InvalidStateError' }));
    await expect(new TabShare().start()).rejects.toThrow('Document is not focused');
  });

  it('says unsupported where the browser can’t share a tab', async () => {
    stubMediaDevices({});
    expect(await new TabShare().start()).toBe('unsupported');
    vi.stubGlobal('navigator', undefined);
    expect(await new TabShare().start()).toBe('unsupported');
  });

  it('opens the picker once while a tab is shared', async () => {
    const getDisplayMedia = stubDisplayMedia(fakeStream().stream);
    const share = new TabShare();
    await share.start();
    expect(await share.start()).toBe('sharing');
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  });
});

describe('TabShare ending', () => {
  it('stops every track on stop, once', async () => {
    const { stream, track } = fakeStream();
    stubDisplayMedia(stream);
    const share = new TabShare();
    const listener = vi.fn();
    await share.start();
    share.subscribe(listener);

    share.stop();
    share.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(share.sharing()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ends when Chrome’s Stop sharing is pressed or the shared tab closes', async () => {
    const { stream, track } = fakeStream();
    stubDisplayMedia(stream);
    const share = new TabShare();
    await share.start();

    track.end();
    expect(share.sharing()).toBe(false);
    expect(await share.start()).toBe('sharing');
  });

  it('ignores the end of an older share', async () => {
    const first = fakeStream();
    stubDisplayMedia(first.stream);
    const share = new TabShare();
    await share.start();
    share.stop();
    stubDisplayMedia(fakeStream().stream);
    await share.start();

    first.track.end();
    expect(share.sharing()).toBe(true);
  });

  it('stops calling a listener once it unsubscribes', async () => {
    stubDisplayMedia(fakeStream().stream);
    const share = new TabShare();
    const listener = vi.fn();
    share.subscribe(listener)();
    await share.start();
    expect(listener).not.toHaveBeenCalled();
  });
});
