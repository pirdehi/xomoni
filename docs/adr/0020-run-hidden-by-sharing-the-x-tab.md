# ADR-0020: Run hidden by sharing the X tab with the dashboard

- Status: Accepted
- Date: 2026-11-04

## Context

Chrome stops rendering a page it doesn't show: a minimized window, one fully covered by other windows, or one on another desktop (PLAYBOOK F5, #118). The page gets no animation frames and no IntersectionObserver or ResizeObserver callbacks, and its timers run once a second. X's menus never finish opening in such a page, so a job waits until the X window is on screen again. Keeping part of a small window visible (#138) and raising it when the person is away (#134) helped. But in the pilot, a job still waited for hours behind the person's maximized window while they worked. People want to minimize the X window like any other.

A spike in Chrome for Testing 156, with no command-line flags, measured an X-like test page:

| Test page state | Animation frames per second | Observers | Timer runs per second | `visibilityState` |
| --- | --- | --- | --- | --- |
| On screen | 60 | yes | 4 | visible |
| Window minimized | 0 | no | 1 | hidden |
| Minimized, tab shared with an extension page through `getDisplayMedia` | 60 | yes | 4 | visible |
| Both the test page and the sharing page minimized | 60 | yes | 4 | visible |
| Window covered by another window, tab shared | 60 | yes | 4 | visible |
| Sharing stopped | 0 | no | 1 | hidden |

Chrome renders a tab that is being captured as if it were on screen, so that what it sends stays current. Casting a tab relies on this too.

## Decision

1. **"Run hidden" shares the X tab with the dashboard.** The button is on the running-job banner, and on the "needs its X window on screen" alert. It calls `getDisplayMedia` from the dashboard, which is the person's click. Chrome's picker opens, the person chooses the tab in the small X window, and the job keeps going with that window minimized or covered.
2. **Only a tab, and almost nothing of it.**
   - The picker leaves out whole screens and the dashboard itself, and asks for no audio. Sharing a tab's audio would mute it.
   - A window that is chosen is stopped at once.
   - The stream asks for one 64-pixel frame a second. Its frames are never read, shown, stored or sent ([ADR-0004](0004-x-data-stays-local.md)). The stream is only held, in `ui/tab-share.ts`.
3. **Sharing ends when it stops helping:**
   - when the job ends or pauses;
   - when the person presses Chrome's own "Stop sharing" or the dashboard's "Stop running hidden";
   - when the shared tab closes;
   - when the job still waits for a hidden X window 15 s after sharing. The X tab, once shared, is never hidden, so in that case the person chose another tab, and Xomoni says so.
4. **Nothing about X changes.** Chrome itself renders the tab. No header is removed and no event, page API or visibility state is faked ([ADR-0003](0003-no-credentials-no-evasion.md)). X sees a page that Chrome really draws.

## Consequences

- The X window can be minimized while a job runs, after one choice in Chrome's picker per run.
- No new permission: `getDisplayMedia` needs none in an extension page.
- Chrome marks the X tab as shared, with its own bar to stop sharing. The person always sees that it is on and can end it.
- A shared tab is drawn at full rate, so it uses about the power of a visible window. This is no more than keeping the window on screen.
- The other F5 measures stay for runs that aren't shared: waiting for a hidden window, keeping the display on, and raising the window when the person is away.
- Still to check in the pilot: whether a shared tab keeps rendering on a locked screen. If it does, a shared run could let the display sleep and keep only the system awake.

## Alternatives considered

- **`chrome.tabCapture`.** No picker, but Chrome allows it only on a tab where the person invoked the extension (activeTab). The X window is a popup without a toolbar, and a click in the dashboard doesn't count. The spike got "Extension has not been invoked for the current page".
- **An iframe of x.com, in the dashboard or an offscreen document.** X forbids being framed (`X-Frame-Options`, `frame-ancestors`). Removing those headers gets around X's security, which ADR-0003 rules out. A frame in a hidden page is paused too.
- **Faking `document.visibilityState`, or replacing `requestAnimationFrame` in X's page.** That changes X's page to make it believe something false, which ADR-0003 rules out. It also wouldn't make Chrome run the observers.
- **Chrome command-line flags** (`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`). They work: Playwright launches Chromium with them, and its pages never go hidden. But they need Chrome to be restarted from a terminal, they apply to every tab, and an extension can't set them.
- **A window moved mostly off-screen, or a tiny window with the page zoomed out.** Chrome needs at least half of a window on screen. A tiny window still has to stay visible, so it can still be covered.
- **X's official API from a server.** It works with the browser closed. It is deferred: it costs money per delete and would change ADR-0004 and ADR-0006.
