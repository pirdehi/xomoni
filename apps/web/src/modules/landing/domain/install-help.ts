// The install questions' rules (#306): the answers' anchors in the order /install lists them, where each browser Xomoni
// names keeps Developer mode, and which answer is about the visitor's own browser or device. Pure: the page passes the
// platform it read.
import { type Platform, browserName, developerModeWhere, extensionsAddress } from './install-guide';

/**
 * The install questions, in the order /install lists them. Each id is its answer's anchor on the page
 * (`/install#developer-mode`), so these are part of the site's links: rename one only with a reason.
 */
export const INSTALL_QUESTIONS = [
  'developer-mode',
  'wrong-folder',
  'turned-off',
  'developer-mode-warning',
  'update',
  'not-recognized',
  'browsers',
  'your-data',
  'ask',
] as const;

/** One of the install questions. */
export type InstallQuestionId = (typeof INSTALL_QUESTIONS)[number];

/** The id of the questions' section on /install, for a link to all of them (`/install#install-help`). */
export const INSTALL_HELP_ID = 'install-help';

/**
 * The link to a question's answer from /install itself: the fragment alone, so the browser scrolls to it without
 * leaving the page, and the guide keeps the step the person is on.
 */
export function questionHref(question: InstallQuestionId): string {
  return `#${question}`;
}

/** A browser Xomoni names, with its extensions page and where its *Developer mode* switch is there. */
export interface DeveloperModePlace {
  browser: 'chrome' | 'edge' | 'brave';
  /** As the steps name it, such as `Edge`. */
  name: string;
  /** Its extensions page, such as `edge://extensions`. */
  address: string;
  /** Where the switch is on that page, such as `in the panel on the left`. */
  where: string;
}

/** Where *Developer mode* is in Chrome, Edge and Brave, in that order, in the same words as the steps. */
export const DEVELOPER_MODE_PLACES: readonly DeveloperModePlace[] = (['chrome', 'edge', 'brave'] as const).map(
  (browser) => ({
    browser,
    name: browserName(browser),
    address: extensionsAddress(browser),
    where: developerModeWhere(browser),
  }),
);

/**
 * The answer about the visitor's own browser or device, which the page marks: which browsers and devices run Xomoni,
 * for a phone or tablet and for a browser that can't run it (Firefox, Safari). None in Chrome, Edge, Brave or another
 * Chromium browser on a computer, where *Developer mode* marks the browser's own line instead.
 */
export function ownQuestion(platform: Platform): InstallQuestionId | null {
  return platform.phone || platform.browser === 'unsupported' ? 'browsers' : null;
}
