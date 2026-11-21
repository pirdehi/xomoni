// The install guide's illustrations (#299, task 1.7): short looping drawings of the browser for the steps that are
// hard to picture from words alone. Which drawing each step shows, how it differs per browser and computer, and what
// it says in words. Pure: the page draws them (`ui/install-visuals.tsx`). They are schematic, never a screenshot,
// and carry no browser's or platform's logo.
import {
  type BrowserKind,
  type InstallStepId,
  type OsKind,
  type Platform,
  developerModeWhere,
  extensionsAddress,
} from './install-guide';

/** The illustrations, in the order the guide shows them: Developer mode, the folder dragged in, pinning Xomoni. */
export const INSTALL_VISUALS = ['developer-mode', 'add-folder', 'pin'] as const;

/** One of the install guide's illustrations. */
export type InstallVisualId = (typeof INSTALL_VISUALS)[number];

/**
 * Which illustrations a step shows, in order: adding Xomoni shows turning on Developer mode and dragging the folder
 * in; following it here shows pinning it, since Xomoni is opened from the puzzle icon. The other steps show none.
 */
export function visualsOf(step: InstallStepId): readonly InstallVisualId[] {
  switch (step) {
    case 'add':
      return ['developer-mode', 'add-folder'];
    case 'connect':
      return ['pin'];
    case 'risks':
    case 'download':
    case 'unzip':
      return [];
  }
}

/**
 * How the extensions page is laid out where *Developer mode* is: Edge keeps it in a panel on the left (`side-panel`);
 * Chrome, Brave and the others in a bar at the top, on the right (`top-bar`), as `developerModeWhere` says.
 */
export type PageLayout = 'top-bar' | 'side-panel';

/** The extensions page's layout in this browser. Before the page knows the browser, the general one: the top bar. */
export function pageLayoutOf(browser: BrowserKind): PageLayout {
  return browser === 'edge' ? 'side-panel' : 'top-bar';
}

/**
 * The window drawn around the page: a Mac's three dots on the left, Windows' three buttons on the right, or a plain
 * frame where the computer isn't known. Shapes only, never a system's logo.
 */
export type WindowFrame = 'mac' | 'windows' | 'plain';

/** The window frame for this computer. */
export function windowFrameOf(os: OsKind): WindowFrame {
  switch (os) {
    case 'mac':
      return 'mac';
    case 'windows':
      return 'windows';
    case 'other':
      return 'plain';
  }
}

/** What keeps an extension in the toolbar from the puzzle icon's menu: a pin (Chrome, Brave), or Edge's eye. */
export type ToolbarControl = 'pin' | 'eye';

/** The toolbar control in this browser; the pin in general words. */
export function toolbarControlOf(browser: BrowserKind): ToolbarControl {
  return browser === 'edge' ? 'eye' : 'pin';
}

/**
 * The words drawn inside the illustrations: the browser's own labels, as its pages show them in English, and Xomoni's
 * folder. In one place so the drawings can be translated with the page, never baked into shapes.
 */
export const VISUAL_WORDS = {
  extensions: 'Extensions',
  installed: 'Installed extensions',
  shortcuts: 'Keyboard shortcuts',
  developerMode: 'Developer mode',
  loadUnpacked: 'Load unpacked',
  pack: 'Pack extension',
  update: 'Update',
  dropToInstall: 'Drop to install',
  folder: 'xomoni-extension',
  xomoni: 'Xomoni',
  otherExtension: 'Another extension',
  manage: 'Manage extensions',
  welcomeTab: 'Welcome',
  welcomePage: 'xomoni.com/welcome',
} as const;

/** One illustration as the page draws it for a browser and computer, with what it shows in words. */
export interface InstallVisual {
  id: InstallVisualId;
  /** A short name, for its *Pause* and *Play* button. */
  title: string;
  layout: PageLayout;
  frame: WindowFrame;
  control: ToolbarControl;
  /** The extensions page's address, written in the drawing's address bar (`extensionsAddress`). */
  address: string;
  /**
   * What the drawing shows, in words: its caption and its text alternative. It says what the step's own text says,
   * which stays the instruction; the drawing only shows where.
   */
  caption: string;
}

/** Each illustration's short name. */
const TITLES: Record<InstallVisualId, string> = {
  'developer-mode': 'turning on Developer mode',
  'add-folder': 'dragging the folder in',
  pin: 'pinning Xomoni',
};

/** What an illustration shows, in words, for this browser. */
function captionOf(id: InstallVisualId, browser: BrowserKind): string {
  const address = extensionsAddress(browser);
  switch (id) {
    case 'developer-mode':
      return `On ${address}, the Developer mode switch ${developerModeWhere(browser)} is turned on, and Load unpacked appears.`;
    case 'add-folder':
      return `The ${VISUAL_WORDS.folder} folder is dragged onto ${address} and dropped there.`;
    case 'pin':
      return toolbarControlOf(browser) === 'eye'
        ? 'The puzzle icon next to the address bar lists the extensions; the eye next to Xomoni (Show in toolbar) puts it in the toolbar.'
        : 'The puzzle icon next to the address bar lists the extensions; the pin next to Xomoni puts it in the toolbar.';
  }
}

/** An illustration as drawn for this browser and computer. */
export function installVisual(id: InstallVisualId, platform: Platform): InstallVisual {
  return {
    id,
    title: TITLES[id],
    layout: pageLayoutOf(platform.browser),
    frame: windowFrameOf(platform.os),
    control: toolbarControlOf(platform.browser),
    address: extensionsAddress(platform.browser),
    caption: captionOf(id, platform.browser),
  };
}
