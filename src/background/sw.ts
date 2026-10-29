// Service worker: stores what the content script observes and opens the dashboard.
import { db, kvSet, upsertAccount, upsertItems } from '../shared/db';
import type { RuntimeMessage } from '../shared/messages';
import { ATTENTION_ID } from '../shared/notify';

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
    await chrome.windows.update(tab.windowId, { focused: true, ...(win.state === 'minimized' && { state: 'normal' as const }) });
  } catch {
    await openDashboard();
  }
}

chrome.action.onClicked.addListener(() => void openDashboard());

chrome.notifications.onClicked.addListener((id) => {
  void chrome.notifications.clear(id);
  void (id === ATTENTION_ID ? focusWorker() : openDashboard());
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void openDashboard();
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
  if (!sender.tab) return;
  void handle(message).catch((err) => console.warn('[xomoni] failed to store observation', err));
});

async function handle(message: RuntimeMessage) {
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
      await upsertAccount({ ...profile });
      break;
    }
    case 'rate':
      await db.limits.put(message.obs);
      break;
  }
}
