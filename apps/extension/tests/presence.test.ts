import { afterEach, describe, expect, it, vi } from 'vitest';
import { presence } from '../src/engine/presence';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

/** `chrome.idle` and `chrome.power` as fakes; `state` is what `queryState` answers. */
function stubChrome(state: Promise<string>) {
  const chrome = {
    idle: { queryState: vi.fn(() => state) },
    power: { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() },
  };
  vi.stubGlobal('chrome', chrome);
  return chrome;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('presence.away (chrome.idle)', () => {
  it('is away only when Chrome reports the person idle', async () => {
    const chrome = stubChrome(Promise.resolve('idle'));
    expect(await presence.away(120)).toBe(true);
    expect(chrome.idle.queryState).toHaveBeenCalledWith(120);
  });

  it('is not away while the person is active', async () => {
    stubChrome(Promise.resolve('active'));
    expect(await presence.away(120)).toBe(false);
  });

  it('is not away on a locked screen, where bringing a window forward shows nothing', async () => {
    stubChrome(Promise.resolve('locked'));
    expect(await presence.away(120)).toBe(false);
  });

  it('asks for at least Chrome’s 15-second minimum, in whole seconds', async () => {
    const chrome = stubChrome(Promise.resolve('active'));
    await presence.away(3);
    await presence.away(90.4);
    expect(chrome.idle.queryState.mock.calls).toEqual([[15], [90]]);
  });

  it('answers “not away” instead of throwing when Chrome can’t tell', async () => {
    stubChrome(Promise.reject(new Error('no idle API')));
    expect(await presence.away(120)).toBe(false);
    vi.stubGlobal('chrome', undefined);
    expect(await presence.away(120)).toBe(false);
  });
});

describe('presence.keepDisplayOn (chrome.power)', () => {
  it('keeps the display on, then lets it sleep again', () => {
    const chrome = stubChrome(Promise.resolve('active'));
    presence.keepDisplayOn(true);
    expect(chrome.power.requestKeepAwake).toHaveBeenCalledWith('display');
    presence.keepDisplayOn(false);
    expect(chrome.power.releaseKeepAwake).toHaveBeenCalledOnce();
  });

  it('never throws without the power API', () => {
    vi.stubGlobal('chrome', {});
    expect(() => presence.keepDisplayOn(true)).not.toThrow();
    expect(() => presence.keepDisplayOn(false)).not.toThrow();
  });
});

describe('the “Keep going while I’m away” setting', () => {
  it('is on by default, also for settings saved before it existed', () => {
    expect(DEFAULT_SETTINGS.whileAway).toBe(true);
    expect(normalizeSettings({ notifications: false }).whileAway).toBe(true);
    expect(normalizeSettings(null).whileAway).toBe(true);
  });

  it('stays off once turned off', () => {
    expect(normalizeSettings({ whileAway: false }).whileAway).toBe(false);
  });
});
