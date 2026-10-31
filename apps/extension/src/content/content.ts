// Isolated-world content script on x.com: bridges the page interceptor to the
// extension and executes actor commands from the dashboard.
import { isCapture, offerPort } from '../shared/bridge';
import type { ActorCommand } from '../shared/messages';
import { runCommand } from './actor';
import { handleCapture } from './net';

// Captures arrive only on this private channel, never through window messages, which any script on the
// page could forge (#59). Its other end goes to the interceptor before X's scripts run.
const channel = new MessageChannel();
channel.port1.onmessage = (event) => {
  if (isCapture(event.data)) handleCapture(event.data);
};
offerPort(document, channel.port2);

chrome.runtime.onMessage.addListener((message: { type?: string; command?: ActorCommand }, _sender, sendResponse) => {
  if (message?.type !== 'actor' || !message.command) return;
  runCommand(message.command).then(sendResponse, (err) => sendResponse({ error: String(err?.message ?? err) }));
  return true;
});
