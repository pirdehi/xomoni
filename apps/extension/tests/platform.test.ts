// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('platform: the dashboard page’s composition root', () => {
  it('lets the display sleep again when the dashboard closes in the middle of a job (#136)', async () => {
    const power = { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() };
    vi.stubGlobal('chrome', { power });
    const { chromePorts } = await import('../src/engine/platform');
    chromePorts.presence.keepDisplayOn(true);
    expect(power.requestKeepAwake).toHaveBeenCalledWith('display');

    window.dispatchEvent(new Event('pagehide'));

    expect(power.releaseKeepAwake).toHaveBeenCalledOnce();
  });
});
