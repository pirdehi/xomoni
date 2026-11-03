// Chrome adapter for the engine's `Presence` port: `chrome.idle` tells whether the person stepped away, and
// `chrome.power` keeps the display on while a job runs, so the X window stays on screen (Chrome pauses pages it
// doesn't show). Neither reads anything but the idle state; nothing leaves the browser.
import type { Presence } from './ports';

/** Chrome's shortest idle threshold, in seconds. */
const MIN_IDLE_SECONDS = 15;

/** The person and the display, through `chrome.idle` and `chrome.power`. */
export const presence: Presence = {
  async away(seconds) {
    try {
      const state = await chrome.idle.queryState(Math.max(MIN_IDLE_SECONDS, Math.round(seconds)));
      // A locked screen shows no window at all, so bringing the X window forward would not help.
      return state === 'idle';
    } catch {
      return false;
    }
  },
  keepDisplayOn(on) {
    try {
      if (on) chrome.power.requestKeepAwake('display');
      else chrome.power.releaseKeepAwake();
    } catch {
      // Without the API there is nothing to hold; the job still waits for the window as before.
    }
  },
};
