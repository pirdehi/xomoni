// The install guide's rules (#299): which browser and computer the visitor is on, the words that differ between them,
// and the order of the steps. Pure: the page reads `navigator` and passes what it found.

/**
 * The browser, as far as the steps go: one Xomoni names (`chrome`, `edge`, `brave`), another browser built on Chromium
 * or one not known yet (`other`, told in general words), or one that can't run Xomoni at all (`unsupported`: Firefox,
 * Safari).
 */
export type BrowserKind = 'chrome' | 'edge' | 'brave' | 'other' | 'unsupported';

/** The computer's system, for how to unzip: a Mac, Windows, or anything else (told in general words). */
export type OsKind = 'mac' | 'windows' | 'other';

/** Where the visitor is. `phone` covers tablets too: Xomoni runs on neither. */
export interface Platform {
  browser: BrowserKind;
  os: OsKind;
  phone: boolean;
}

/** What the page knows before it can read the browser (on the server and while hydrating): general words, a computer. */
export const UNKNOWN_PLATFORM: Platform = { browser: 'other', os: 'other', phone: false };

/** What the browser says about itself. Every field but `userAgent` is missing in some browsers. */
export interface NavigatorHints {
  userAgent: string;
  /** `navigator.userAgentData.brands` (Chromium only), such as `Google Chrome` or `Microsoft Edge`. */
  brands?: readonly { brand: string }[];
  /** `navigator.userAgentData.platform` (Chromium only), such as `macOS` or `Windows`. */
  platform?: string;
  /** `navigator.userAgentData.mobile` (Chromium only). */
  mobile?: boolean;
  /** Whether `navigator.brave` exists: Brave says it is Chrome in its user agent, and only this tells them apart. */
  brave?: boolean;
  /** `navigator.maxTouchPoints`: an iPad asks for desktop pages with a Mac's user agent, and only its touch gives it away. */
  touchPoints?: number;
}

/** Phones and tablets, by their user agent (the same list the site uses where Xomoni acts, `isPhoneBrowser`). */
const PHONE_AGENT = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i;

/**
 * The browser from its hints. The brands are the surest sign where Chromium gives them; the user agent is read only
 * without them. A Chromium browser not named in either (Opera, Vivaldi, Arc) is `other`.
 */
export function browserOf(hints: NavigatorHints): BrowserKind {
  const ua = hints.userAgent;
  const brands = (hints.brands ?? []).map((b) => b.brand);
  if (hints.brave === true || brands.includes('Brave')) return 'brave';
  if (brands.includes('Microsoft Edge') || /\bEdg(?:e|A|iOS)?\//.test(ua)) return 'edge';
  if (/\b(?:Firefox|FxiOS)\//.test(ua)) return 'unsupported';
  if (brands.length > 0) return brands.includes('Google Chrome') ? 'chrome' : 'other';
  if (/\b(?:OPR|Opera|Vivaldi|YaBrowser|SamsungBrowser)\//.test(ua)) return 'other';
  if (/\b(?:Chrome|CriOS)\//.test(ua)) return 'chrome';
  if (/\bSafari\//.test(ua)) return 'unsupported';
  return 'other';
}

/** The system from its hints: Chromium's platform hint first, else the user agent (an iPhone's says "like Mac OS X"). */
export function osOf(hints: NavigatorHints): OsKind {
  const platform = hints.platform?.toLowerCase();
  if (platform) return platform === 'macos' ? 'mac' : platform === 'windows' ? 'windows' : 'other';
  if (/\bMacintosh\b/.test(hints.userAgent)) return 'mac';
  if (/\bWindows\b/.test(hints.userAgent)) return 'windows';
  return 'other';
}

/** Whether this is a phone or tablet, where Xomoni can't be installed. */
export function isPhone(hints: NavigatorHints): boolean {
  if (hints.mobile === true || PHONE_AGENT.test(hints.userAgent)) return true;
  return /\bMacintosh\b/.test(hints.userAgent) && (hints.touchPoints ?? 0) > 1;
}

/** Where the visitor is, from what the browser says. */
export function platformOf(hints: NavigatorHints): Platform {
  return { browser: browserOf(hints), os: osOf(hints), phone: isPhone(hints) };
}

/**
 * The address of the browser's extensions page. Web pages can't link to it, so the guide shows it to copy. Every
 * Chromium browser opens `chrome://extensions` too, so that is the general one.
 */
export function extensionsAddress(browser: BrowserKind): string {
  switch (browser) {
    case 'edge':
      return 'edge://extensions';
    case 'brave':
      return 'brave://extensions';
    case 'chrome':
    case 'other':
    case 'unsupported':
      return 'chrome://extensions';
  }
}

/** The browser's name in the steps' titles; the three Xomoni runs in when it isn't one of them. */
export function browserName(browser: BrowserKind): string {
  switch (browser) {
    case 'chrome':
      return 'Chrome';
    case 'edge':
      return 'Edge';
    case 'brave':
      return 'Brave';
    case 'other':
    case 'unsupported':
      return 'Chrome, Edge or Brave';
  }
}

/** Where the *Developer mode* switch is on the extensions page: Edge has it in its side panel, the others at the top. */
export function developerModeWhere(browser: BrowserKind): string {
  return browser === 'edge' ? 'in the panel on the left' : 'at the top right';
}

/** How to unzip the download on this system, in one or two plain sentences. */
export function unzipHow(os: OsKind): string {
  switch (os) {
    case 'mac':
      return 'Double-click xomoni-extension.zip in your Downloads folder. A folder named xomoni-extension appears next to it.';
    case 'windows':
      return 'Right-click xomoni-extension.zip in your Downloads folder, choose Extract All…, then Extract. A folder named xomoni-extension appears.';
    case 'other':
      return 'Open your Downloads folder and extract xomoni-extension.zip. You get a folder named xomoni-extension.';
  }
}

/** The install steps, in order: the risks, the download, unzipping, adding it to the browser, following it here. */
export const INSTALL_STEPS = ['risks', 'download', 'unzip', 'add', 'connect'] as const;

/** One of the install steps. */
export type InstallStepId = (typeof INSTALL_STEPS)[number];

/** The step the guide goes to once the download starts. */
export const STEP_AFTER_DOWNLOAD: InstallStepId = 'unzip';

/** The step the guide goes to once Xomoni answers in this browser: everything before it is done. */
export const STEP_ONCE_INSTALLED: InstallStepId = 'connect';

/** A step's number, from 1. */
export function stepNumber(step: InstallStepId): number {
  return INSTALL_STEPS.indexOf(step) + 1;
}

/** The step after this one, or null after the last. */
export function stepAfter(step: InstallStepId): InstallStepId | null {
  return INSTALL_STEPS[INSTALL_STEPS.indexOf(step) + 1] ?? null;
}

/** The step before this one, or null before the first. */
export function stepBefore(step: InstallStepId): InstallStepId | null {
  const index = INSTALL_STEPS.indexOf(step);
  return index > 0 ? (INSTALL_STEPS[index - 1] ?? null) : null;
}

/** Whether a step is done because Xomoni already answers in this browser: every step that installs it. */
export function doneOnceInstalled(step: InstallStepId): boolean {
  return stepNumber(step) < stepNumber(STEP_ONCE_INSTALLED);
}
