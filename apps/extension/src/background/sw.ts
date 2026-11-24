// Service worker: stores what the content script observes, opens the dashboard, and answers xomoni.com in the same
// browser: a one-time code the person asked for (#228), one sign-in for the website and the extension (#232), and the
// website's actions, which stop a job or open Xomoni's pages (#251). Profile counts X shows also make the day's numbers
// (#249).
import { WEBSITE_ORIGIN, type XomoniPage } from '@xomoni/bridge';
import { type ActionPorts, answerWebsite } from '../cloud/website';
import { db, kvSet, recordProfileDay, upsertAccount, upsertItems } from '../shared/db';
import { saveIncoming } from '../shared/incoming';
import { fromXPage, parseRuntimeMessage } from '../shared/inbound';
import type { RuntimeMessage } from '../shared/messages';
import { ATTENTION_ID } from '../shared/notify';
import { getSignedOut } from '../shared/session';
import { notePremium } from '../shared/vault/timeline';
import { recentUpdate } from '../shared/update-record';
import { suggestArchivePath } from './archive-downloads';

const DASHBOARD = chrome.runtime.getURL('dashboard.html');

/**
 * Opens the dashboard, or focuses the tab already showing it. `hash` (`#/jobs`) moves it to a page: in the open tab it
 * changes only the fragment, so the page and a job running in it stay.
 */
async function openDashboard(hash = '') {
  const tabs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
  const existing = tabs.find((c) => c.documentUrl?.startsWith(DASHBOARD));
  if (existing?.tabId != null && existing.tabId >= 0) {
    await chrome.tabs.update(existing.tabId, { active: true, ...(hash && { url: DASHBOARD + hash }) });
    if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: DASHBOARD + hash });
}

/** The dashboard's hash for a page the website may open: the website's Activity is the dashboard's job list. */
function pageHash(page: XomoniPage): string {
  return `#/${page === 'activity' ? 'jobs' : page}`;
}

const actionPorts: ActionPorts = { openDashboard: (page) => openDashboard(pageHash(page)) };

/** Brings up the X worker window (tab id stored by WorkerTab in engine/worker-tab.ts). */
async function focusWorker() {
  const { workerTab } = await chrome.storage.session.get('workerTab');
  try {
    if (typeof workerTab !== 'number') throw new Error('No worker window');
    const tab = await chrome.tabs.get(workerTab);
    const win = await chrome.windows.get(tab.windowId);
    await chrome.tabs.update(workerTab, { active: true });
    await chrome.windows.update(tab.windowId, {
      focused: true,
      ...(win.state === 'minimized' && { state: 'normal' as const }),
    });
  } catch {
    await openDashboard();
  }
}

chrome.action.onClicked.addListener(() => void openDashboard());

chrome.notifications.onClicked.addListener((id) => {
  void chrome.notifications.clear(id);
  void (id === ATTENTION_ID ? focusWorker() : openDashboard());
});

// X's archive goes into Downloads/Xomoni while Xomoni expects it, since Chrome won't let Xomoni read Downloads (#196).
chrome.downloads.onDeterminingFilename.addListener(suggestArchivePath);

// On install, Xomoni's dashboard, and xomoni.com/welcome in front of it with this extension's id in the fragment, so the
// site knows Xomoni is in this browser and offers the one sign-in (#244, ADR-0025). On an update, only the dashboard,
// and only after a one-click update (#305, ADR-0033): Chrome closed it to reload, and it says how the update went.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update') {
    void recentUpdate().then((update) => (update ? openDashboard() : undefined));
    return;
  }
  if (details.reason !== 'install') return;
  void openDashboard().then(() =>
    chrome.tabs.create({ url: `${WEBSITE_ORIGIN}/welcome#ext=${chrome.runtime.id}`, active: true }),
  );
});

// xomoni.com in this browser (ADR-0024, ADR-0025, ADR-0027): a one-time code the person asked for, the one sign-in,
// which asks how the extension stands, signs it in or signs it out, and the website's actions on jobs and pages. The manifest lets only https://xomoni.com send; the
// sender is checked again (`answerWebsite`), and anything but those exact messages gets no answer, or `invalid`.
chrome.runtime.onMessageExternal.addListener((raw: unknown, sender, sendResponse) => {
  const answer = answerWebsite(raw, sender, actionPorts);
  if (!answer) return;
  void answer.then(sendResponse, () => sendResponse({ ok: false, reason: 'refused' }));
  return true;
});

// Only Xomoni's own content script in the top frame of an x.com tab is heard, and only with a message whose every
// field has the expected shape (#145): the content script runs inside X's page, so what it sends is untrusted.
chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (!fromXPage(sender, chrome.runtime.id)) return;
  const message = parseRuntimeMessage(raw);
  if (!message) return;
  void handle(message).catch((err: unknown) => console.warn('[xomoni] failed to store observation', err));
});

async function handle(message: RuntimeMessage) {
  // Signed out of Xomoni (#226): what X pages show isn't recorded. X's limits still are: they hold no X content and
  // keep the next run within them.
  if (message.type !== 'rate' && (await getSignedOut())) return;
  switch (message.type) {
    case 'ingest': {
      const known = await db.accounts.get(message.accountId);
      if (!known || (message.handle && known.handle !== message.handle)) {
        await upsertAccount({ id: message.accountId, handle: message.handle ?? known?.handle ?? '' });
      }
      await upsertItems(message.accountId, message.drafts, 'scan', message.observedAt);
      await kvSet('activeAccount', message.accountId);
      break;
    }
    case 'incoming':
      // Only for an X account Xomoni knows, so its data goes when that account's data goes (ADR-0030).
      if (await db.accounts.get(message.accountId)) await saveIncoming(message.accountId, message.replies);
      break;
    case 'profile': {
      const { profile } = message;
      const at = Date.now();
      const before = await db.accounts.get(profile.id);
      await upsertAccount({ ...profile, profileAt: at });
      // A change of X Premium on the person's own profile goes on the timeline once (#425), never at every sighting.
      await notePremium(before, profile.verified, at);
      // The day's profile counts, from the page X already showed (#249): never a request of its own.
      await recordProfileDay(profile.id, profile, at);
      break;
    }
    case 'rate':
      await db.limits.put(message.obs);
      break;
  }
}
