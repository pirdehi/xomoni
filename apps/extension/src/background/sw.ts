// Service worker: stores what the content script observes, opens the dashboard, and answers xomoni.com in the same
// browser: a one-time code the person asked for (#228), and one sign-in for the website and the extension (#232).
import { answerWebsite } from '../cloud/website';
import { db, kvSet, upsertAccount, upsertItems } from '../shared/db';
import { fromXPage, parseRuntimeMessage } from '../shared/inbound';
import type { RuntimeMessage } from '../shared/messages';
import { ATTENTION_ID } from '../shared/notify';
import { getSignedOut } from '../shared/session';
import { suggestArchivePath } from './archive-downloads';

const DASHBOARD = chrome.runtime.getURL('dashboard.html');

async function openDashboard() {
  const tabs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
  const existing = tabs.find((c) => c.documentUrl?.startsWith(DASHBOARD));
  if (existing?.tabId != null && existing.tabId >= 0) {
    await chrome.tabs.update(existing.tabId, { active: true });
    if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: DASHBOARD });
}

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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void openDashboard();
});

// xomoni.com in this browser (ADR-0024, ADR-0025): a one-time code the person asked for, and the one sign-in, which
// asks how the extension stands, signs it in or signs it out. The manifest lets only https://xomoni.com send; the
// sender is checked again (`answerWebsite`), and anything but those exact messages gets no answer, or `invalid`.
chrome.runtime.onMessageExternal.addListener((raw: unknown, sender, sendResponse) => {
  const answer = answerWebsite(raw, sender);
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
    case 'profile': {
      const { profile } = message;
      await upsertAccount({ ...profile, profileAt: Date.now() });
      break;
    }
    case 'rate':
      await db.limits.put(message.obs);
      break;
  }
}
