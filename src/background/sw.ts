// Service worker: stores what the content script observes and opens the dashboard.
import { db, kvSet, upsertAccount, upsertItems } from '../shared/db';
import type { RuntimeMessage } from '../shared/messages';

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

chrome.action.onClicked.addListener(() => void openDashboard());

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
