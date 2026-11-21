import { describe, expect, it } from 'vitest';
import {
  type BrowserKind,
  INSTALL_STEPS,
  type OsKind,
  type Platform,
  UNKNOWN_PLATFORM,
  developerModeWhere,
  extensionsAddress,
  pinHow,
} from './install-guide';
import {
  INSTALL_VISUALS,
  VISUAL_WORDS,
  installVisual,
  pageLayoutOf,
  toolbarControlOf,
  visualsOf,
  windowFrameOf,
} from './install-visuals';

const on = (browser: BrowserKind, os: OsKind): Platform => ({ browser, os, phone: false });
const BROWSERS: readonly BrowserKind[] = ['chrome', 'edge', 'brave', 'other', 'unsupported'];

describe('visualsOf (#299)', () => {
  it('shows Developer mode and the folder dragged in when adding Xomoni, and pinning it when following it here', () => {
    expect(visualsOf('add')).toEqual(['developer-mode', 'add-folder']);
    expect(visualsOf('connect')).toEqual(['pin']);
    for (const step of ['risks', 'download', 'unzip'] as const) expect(visualsOf(step)).toEqual([]);
  });

  it('uses every illustration once, in the guide’s order', () => {
    expect(INSTALL_STEPS.flatMap(visualsOf)).toEqual(INSTALL_VISUALS);
  });
});

describe('the drawing for each browser and computer (#299)', () => {
  it('puts Developer mode in Edge’s left panel, and at the top right everywhere else', () => {
    expect(pageLayoutOf('edge')).toBe('side-panel');
    for (const browser of ['chrome', 'brave', 'other', 'unsupported'] as const)
      expect(pageLayoutOf(browser)).toBe('top-bar');
  });

  it('draws a Mac’s window, Windows’ window, or a plain one where the computer isn’t known', () => {
    expect(windowFrameOf('mac')).toBe('mac');
    expect(windowFrameOf('windows')).toBe('windows');
    expect(windowFrameOf('other')).toBe('plain');
  });

  it('pins with Edge’s eye in Edge, and with a pin everywhere else', () => {
    expect(toolbarControlOf('edge')).toBe('eye');
    for (const browser of ['chrome', 'brave', 'other', 'unsupported'] as const)
      expect(toolbarControlOf(browser)).toBe('pin');
  });

  it('in Chrome on a Mac: chrome://extensions, the top bar, a Mac’s window, the pin', () => {
    expect(installVisual('developer-mode', on('chrome', 'mac'))).toEqual({
      id: 'developer-mode',
      title: 'turning on Developer mode',
      layout: 'top-bar',
      frame: 'mac',
      control: 'pin',
      address: 'chrome://extensions',
      caption:
        'On chrome://extensions, the Developer mode switch at the top right is turned on, and Load unpacked appears.',
    });
  });

  it('in Edge on Windows: edge://extensions, the left panel, Windows’ window, the eye', () => {
    const visual = installVisual('developer-mode', on('edge', 'windows'));
    expect(visual).toMatchObject({
      layout: 'side-panel',
      frame: 'windows',
      control: 'eye',
      address: 'edge://extensions',
    });
    expect(visual.caption).toBe(
      'On edge://extensions, the Developer mode switch in the panel on the left is turned on, and Load unpacked appears.',
    );
    expect(installVisual('pin', on('edge', 'windows')).caption).toBe(
      'The puzzle icon next to the address bar lists the extensions; the eye next to Xomoni (Show in toolbar) puts it in the toolbar.',
    );
  });

  it('in Brave on a Mac: brave://extensions, laid out like Chrome', () => {
    expect(installVisual('add-folder', on('brave', 'mac'))).toMatchObject({
      layout: 'top-bar',
      frame: 'mac',
      control: 'pin',
      address: 'brave://extensions',
      caption: 'The xomoni-extension folder is dragged onto brave://extensions and dropped there.',
    });
  });

  it('before the page knows the browser: the general drawing, as the server renders it', () => {
    expect(installVisual('pin', UNKNOWN_PLATFORM)).toMatchObject({
      layout: 'top-bar',
      frame: 'plain',
      control: 'pin',
      address: 'chrome://extensions',
      caption:
        'The puzzle icon next to the address bar lists the extensions; the pin next to Xomoni puts it in the toolbar.',
    });
  });
});

describe('what each illustration says in words (#299)', () => {
  it('says what the step says: the same address, the same place for Developer mode, the same folder', () => {
    for (const browser of BROWSERS) {
      const platform = on(browser, 'mac');
      const developerMode = installVisual('developer-mode', platform).caption;
      expect(developerMode).toContain(extensionsAddress(browser));
      expect(developerMode).toContain(`Developer mode switch ${developerModeWhere(browser)}`);
      expect(developerMode).toContain(VISUAL_WORDS.loadUnpacked);
      const folder = installVisual('add-folder', platform).caption;
      expect(folder).toContain(`${VISUAL_WORDS.folder} folder`);
      expect(folder).toContain(extensionsAddress(browser));
    }
  });

  it('pins the way the step says to', () => {
    for (const browser of BROWSERS) {
      const caption = installVisual('pin', on(browser, 'windows')).caption;
      expect(caption).toContain('puzzle icon next to the address bar');
      const mark = toolbarControlOf(browser) === 'eye' ? 'the eye next to Xomoni' : 'the pin next to Xomoni';
      expect(caption).toContain(mark);
      expect(pinHow(browser)).toContain(mark);
    }
  });

  it('doesn’t depend on the computer, only on the browser', () => {
    for (const id of INSTALL_VISUALS)
      for (const browser of BROWSERS)
        expect(installVisual(id, on(browser, 'mac')).caption).toBe(installVisual(id, on(browser, 'windows')).caption);
  });

  it('gives each illustration a name for its Pause and Play button', () => {
    expect(INSTALL_VISUALS.map((id) => installVisual(id, UNKNOWN_PLATFORM).title)).toEqual([
      'turning on Developer mode',
      'dragging the folder in',
      'pinning Xomoni',
    ]);
  });
});
