// "Run hidden" (#140, ADR-0020): the dashboard shares the X worker's tab with itself, because Chrome renders a tab
// that is being shared as if it were on screen, even when its window is minimized or covered. Without that Chrome
// stops a hidden page's rendering steps and X's menus never finish opening (PLAYBOOK F5). The stream is only held:
// its frames are never read, shown, stored or sent (ADR-0004).

/**
 * How a request to share ended: `sharing`; `cancelled` (the person closed Chrome's picker); `not-a-tab` (they chose
 * a window, which is stopped at once); `unsupported` (this browser can't share a tab).
 */
export type ShareOutcome = 'sharing' | 'cancelled' | 'not-a-tab' | 'unsupported';

// Chrome's picker options that TypeScript's DOM types don't list yet.
type PickerOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
};

/**
 * What Chrome's picker offers and what it captures: tabs first, never the dashboard itself or a whole screen, no
 * audio (sharing a tab's audio would mute it), and one tiny frame a second, since nothing looks at the frames.
 */
export const SHARE_OPTIONS: PickerOptions = {
  video: { displaySurface: 'browser', frameRate: { max: 1 }, width: { max: 64 }, height: { max: 64 } },
  audio: false,
  preferCurrentTab: false,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'exclude',
  systemAudio: 'exclude',
  monitorTypeSurfaces: 'exclude',
};

const stopAll = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop());

/**
 * The shared X tab, if any, as an external store for `useSyncExternalStore`. Sharing ends with the dashboard tab,
 * with Chrome's own "Stop sharing", when the shared tab closes, or with `stop`.
 */
export class TabShare {
  private stream: MediaStream | null = null;
  private readonly listeners = new Set<() => void>();

  /** Whether a tab is shared now. */
  readonly sharing = () => this.stream != null;

  /** Calls `listener` whenever sharing starts or stops; returns the unsubscribe function. */
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /**
   * Opens Chrome's picker for the person to choose the X tab. Must run from a click: Chrome only shows the picker
   * after a user gesture. Rethrows errors other than the person's refusal.
   */
  async start(): Promise<ShareOutcome> {
    if (this.stream) return 'sharing';
    const media = (globalThis.navigator as Partial<Navigator> | undefined)?.mediaDevices;
    if (typeof media?.getDisplayMedia !== 'function') return 'unsupported';
    let stream: MediaStream;
    try {
      stream = await media.getDisplayMedia(SHARE_OPTIONS);
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name === 'NotAllowedError') return 'cancelled';
      throw err;
    }
    const [track] = stream.getVideoTracks();
    // A window keeps rendering its own way; only a shared tab is drawn while hidden.
    if (track?.getSettings().displaySurface !== 'browser') {
      stopAll(stream);
      return 'not-a-tab';
    }
    track.addEventListener('ended', () => this.release(stream), { once: true });
    this.stream = stream;
    this.emit();
    return 'sharing';
  }

  /** Stops sharing, if a tab is shared. */
  stop() {
    if (this.stream) this.release(this.stream);
  }

  private release(stream: MediaStream) {
    stopAll(stream);
    if (this.stream !== stream) return;
    this.stream = null;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

/** The dashboard's one shared tab. */
export const tabShare = new TabShare();
