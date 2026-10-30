// Isolated-world content script on x.com: bridges the page interceptor to the
// extension and executes actor commands from the dashboard.
import type { ActorCommand } from '../shared/messages';
import { runCommand } from './actor';
import { handleCapture } from './net';

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'xomoni-net') return;
  handleCapture(event.data);
});

chrome.runtime.onMessage.addListener((message: { type?: string; command?: ActorCommand }, _sender, sendResponse) => {
  if (message?.type !== 'actor' || !message.command) return;
  runCommand(message.command).then(sendResponse, (err) => sendResponse({ error: String(err?.message ?? err) }));
  return true;
});
