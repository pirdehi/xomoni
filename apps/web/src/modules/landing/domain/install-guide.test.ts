import { describe, expect, it } from 'vitest';
import {
  INSTALL_STEPS,
  STEP_AFTER_DOWNLOAD,
  STEP_ONCE_INSTALLED,
  UNKNOWN_PLATFORM,
  browserName,
  browserOf,
  developerModeWhere,
  doneOnceInstalled,
  extensionsAddress,
  isPhone,
  osOf,
  pinHow,
  platformOf,
  stepAfter,
  stepBefore,
  stepNumber,
  unzipHow,
} from './install-guide';

// Real user agents, as each browser sends them.
const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/116.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

const brands = (...names: string[]) => [{ brand: 'Not_A Brand' }, ...names.map((brand) => ({ brand }))];

describe('browserOf (#299)', () => {
  it('names Chrome, Edge and Brave from Chromium’s brands', () => {
    expect(browserOf({ userAgent: UA.chromeMac, brands: brands('Chromium', 'Google Chrome') })).toBe('chrome');
    expect(browserOf({ userAgent: UA.edgeWindows, brands: brands('Chromium', 'Microsoft Edge') })).toBe('edge');
    expect(browserOf({ userAgent: UA.chromeMac, brands: brands('Chromium', 'Brave') })).toBe('brave');
  });

  it('tells Brave from Chrome by navigator.brave, when its user agent and brands say Chrome', () => {
    expect(browserOf({ userAgent: UA.chromeWindows, brave: true })).toBe('brave');
    expect(browserOf({ userAgent: UA.chromeWindows, brands: brands('Chromium', 'Google Chrome'), brave: true })).toBe(
      'brave',
    );
  });

  it('reads the user agent where there are no brands', () => {
    expect(browserOf({ userAgent: UA.chromeWindows })).toBe('chrome');
    expect(browserOf({ userAgent: UA.edgeWindows })).toBe('edge');
  });

  it('calls other Chromium browsers by general words', () => {
    expect(browserOf({ userAgent: UA.operaWindows })).toBe('other');
    expect(browserOf({ userAgent: UA.operaWindows, brands: brands('Chromium', 'Opera') })).toBe('other');
    // Chromium itself, as in a test browser, gives no product brand.
    expect(browserOf({ userAgent: UA.chromeLinux, brands: brands('Chromium') })).toBe('other');
    expect(browserOf({ userAgent: '' })).toBe('other');
  });

  it('says Firefox and Safari can’t run Xomoni', () => {
    expect(browserOf({ userAgent: UA.firefoxMac })).toBe('unsupported');
    expect(browserOf({ userAgent: UA.safariMac })).toBe('unsupported');
  });
});

describe('osOf (#299)', () => {
  it('prefers Chromium’s platform hint', () => {
    expect(osOf({ userAgent: UA.chromeWindows, platform: 'macOS' })).toBe('mac');
    expect(osOf({ userAgent: UA.chromeMac, platform: 'Windows' })).toBe('windows');
    expect(osOf({ userAgent: UA.chromeMac, platform: 'Linux' })).toBe('other');
  });

  it('reads the user agent without it, and doesn’t take an iPhone for a Mac', () => {
    expect(osOf({ userAgent: UA.safariMac })).toBe('mac');
    expect(osOf({ userAgent: UA.chromeWindows })).toBe('windows');
    expect(osOf({ userAgent: UA.chromeLinux })).toBe('other');
    expect(osOf({ userAgent: UA.iPhone })).toBe('other');
  });
});

describe('isPhone (#299)', () => {
  it('finds phones and tablets by their user agent or Chromium’s mobile hint', () => {
    expect(isPhone({ userAgent: UA.iPhone })).toBe(true);
    expect(isPhone({ userAgent: UA.android })).toBe(true);
    expect(isPhone({ userAgent: UA.chromeLinux, mobile: true })).toBe(true);
    expect(isPhone({ userAgent: UA.chromeWindows, mobile: false })).toBe(false);
  });

  it('finds an iPad asking for the desktop page by its touch screen, and leaves a Mac alone', () => {
    expect(isPhone({ userAgent: UA.safariMac, touchPoints: 5 })).toBe(true);
    expect(isPhone({ userAgent: UA.safariMac, touchPoints: 0 })).toBe(false);
    expect(isPhone({ userAgent: UA.safariMac })).toBe(false);
    // A Windows laptop with a touch screen is still a computer.
    expect(isPhone({ userAgent: UA.chromeWindows, touchPoints: 10 })).toBe(false);
  });
});

describe('platformOf (#299)', () => {
  it('puts the three together, for every browser on each system', () => {
    const cases = [
      [{ userAgent: UA.chromeMac, brands: brands('Google Chrome'), platform: 'macOS' }, 'chrome', 'mac'],
      [{ userAgent: UA.chromeWindows, brands: brands('Google Chrome'), platform: 'Windows' }, 'chrome', 'windows'],
      [{ userAgent: UA.edgeWindows, brands: brands('Microsoft Edge'), platform: 'Windows' }, 'edge', 'windows'],
      [{ userAgent: UA.chromeMac, brands: brands('Microsoft Edge'), platform: 'macOS' }, 'edge', 'mac'],
      [{ userAgent: UA.chromeMac, brands: brands('Brave'), platform: 'macOS', brave: true }, 'brave', 'mac'],
      [{ userAgent: UA.chromeWindows, platform: 'Windows', brave: true }, 'brave', 'windows'],
      [{ userAgent: UA.chromeLinux, brands: brands('Google Chrome'), platform: 'Linux' }, 'chrome', 'other'],
    ] as const;
    for (const [hints, browser, os] of cases) expect(platformOf(hints)).toEqual({ browser, os, phone: false });
    expect(platformOf({ userAgent: UA.iPhone })).toEqual({ browser: 'unsupported', os: 'other', phone: true });
  });

  it('starts from general words on a computer, before the browser can be read', () => {
    expect(UNKNOWN_PLATFORM).toEqual({ browser: 'other', os: 'other', phone: false });
  });
});

describe('the words for each browser and system (#299)', () => {
  it('gives each browser its own extensions page, and Chrome’s to the rest', () => {
    expect(extensionsAddress('chrome')).toBe('chrome://extensions');
    expect(extensionsAddress('edge')).toBe('edge://extensions');
    expect(extensionsAddress('brave')).toBe('brave://extensions');
    expect(extensionsAddress('other')).toBe('chrome://extensions');
    expect(extensionsAddress('unsupported')).toBe('chrome://extensions');
  });

  it('names the browser, or the three Xomoni runs in', () => {
    expect(browserName('chrome')).toBe('Chrome');
    expect(browserName('edge')).toBe('Edge');
    expect(browserName('brave')).toBe('Brave');
    expect(browserName('other')).toBe('Chrome, Edge or Brave');
    expect(browserName('unsupported')).toBe('Chrome, Edge or Brave');
  });

  it('finds Developer mode in Edge’s side panel and at the top elsewhere', () => {
    expect(developerModeWhere('edge')).toBe('in the panel on the left');
    expect(developerModeWhere('chrome')).toBe('at the top right');
    expect(developerModeWhere('brave')).toBe('at the top right');
  });

  it('unzips by double-click on a Mac and Extract All on Windows', () => {
    expect(unzipHow('mac')).toMatch(/^Double-click xomoni-extension\.zip/);
    expect(unzipHow('windows')).toMatch(/^Right-click xomoni-extension\.zip.*Extract All…/);
    expect(unzipHow('other')).toMatch(/extract xomoni-extension\.zip/);
    for (const os of ['mac', 'windows', 'other'] as const) expect(unzipHow(os)).toContain('xomoni-extension');
  });

  it('pins from the puzzle icon: with the pin in Chrome and Brave, with the eye in Edge, naming both in general', () => {
    const start = 'Pin Xomoni to the toolbar to keep it one click away: click the puzzle icon next to the address bar,';
    expect(pinHow('chrome')).toBe(`${start} then the pin next to Xomoni.`);
    expect(pinHow('brave')).toBe(`${start} then the pin next to Xomoni.`);
    expect(pinHow('edge')).toBe(`${start} then the eye next to Xomoni (Show in toolbar).`);
    expect(pinHow('other')).toBe(`${start} then the pin next to Xomoni (in Edge, the eye: Show in toolbar).`);
    expect(pinHow('unsupported')).toBe(pinHow('other'));
  });
});

describe('the steps (#299)', () => {
  it('go from the risks to following Xomoni here, numbered from 1', () => {
    expect(INSTALL_STEPS).toEqual(['risks', 'download', 'unzip', 'add', 'connect']);
    expect(INSTALL_STEPS.map(stepNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(stepAfter('risks')).toBe('download');
    expect(stepAfter('connect')).toBeNull();
    expect(stepBefore('download')).toBe('risks');
    expect(stepBefore('risks')).toBeNull();
  });

  it('unzip after the download, and follow Xomoni here once it answers, the steps before it done', () => {
    expect(STEP_AFTER_DOWNLOAD).toBe('unzip');
    expect(STEP_ONCE_INSTALLED).toBe('connect');
    expect(INSTALL_STEPS.filter(doneOnceInstalled)).toEqual(['risks', 'download', 'unzip', 'add']);
  });
});
