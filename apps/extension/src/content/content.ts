// Isolated-world content script on x.com: bridges the page interceptor to the
// extension and executes actor commands from the dashboard.
import { isCapture, offerPort } from '../shared/bridge';
import { asObject } from '../shared/json';
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

/** Whether a runtime message is a command from the dashboard for this tab. */
function isActorMessage(message: unknown): message is { type: 'actor'; command: ActorCommand } {
  const m = asObject(message);
  return m?.type === 'actor' && !!asObject(m.command);
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isActorMessage(message)) return;
  runCommand(message.command).then(sendResponse, (err: unknown) =>
    sendResponse({ error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
