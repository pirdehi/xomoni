// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorCommand } from '../src/shared/messages';

const { runCommand, addListener } = vi.hoisted(() => ({
  runCommand: vi.fn<(command: ActorCommand) => Promise<unknown>>(),
  addListener: vi.fn<(listener: Listener) => void>(),
}));

// The actor clicks in X's page; here it only answers, so the test is about which messages reach it.
vi.mock('../src/content/actor', () => ({ runCommand }));

type SendResponse = (response: unknown) => void;
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: SendResponse) => unknown;

const EXTENSION_ID = 'xomoni';
/** The dashboard: a page of the extension itself. */
const DASHBOARD: chrome.runtime.MessageSender = {
  id: EXTENSION_ID,
  origin: `chrome-extension://${EXTENSION_ID}`,
  url: `chrome-extension://${EXTENSION_ID}/dashboard.html`,
};

let listener: Listener;
let listeners = 0;

beforeAll(async () => {
  vi.stubGlobal('chrome', { runtime: { id: EXTENSION_ID, onMessage: { addListener } } });
  await import('../src/content/content');
  listeners = addListener.mock.calls.length;
  listener = addListener.mock.calls[0]![0];
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  runCommand.mockReset();
});

/** Delivers `message` as Chrome does and returns what the listener returned and the reply it sent, if any. */
async function deliver(message: unknown, sender: chrome.runtime.MessageSender = DASHBOARD) {
  const sendResponse = vi.fn<SendResponse>();
  const kept = listener(message, sender, sendResponse);
  await vi.waitFor(() => {
    if (kept === true) expect(sendResponse).toHaveBeenCalled();
  });
  return { kept, sendResponse };
}

describe('content script: commands from the dashboard', () => {
  it('listens for runtime messages once', () => {
    expect(listeners).toBe(1);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'actor'],
    ['another message type', { type: 'ingest', command: { cmd: 'ping' } }],
    ['an actor message without a command', { type: 'actor' }],
    ['an actor message whose command is not an object', { type: 'actor', command: 'delete' }],
    ['an actor message with a null command', { type: 'actor', command: null }],
  ])('ignores %s', async (_, message) => {
    const { kept, sendResponse } = await deliver(message);

    expect(kept).toBeUndefined();
    expect(runCommand).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it.each<[string, chrome.runtime.MessageSender]>([
    ['another extension', { ...DASHBOARD, id: 'someone-else' }],
    [
      'Xomoni’s content script in another x.com tab',
      { id: EXTENSION_ID, origin: 'https://x.com', url: 'https://x.com/home' },
    ],
    ['a page of another extension under Xomoni’s id', { id: EXTENSION_ID, origin: 'chrome-extension://someone-else' }],
    ['a sender that names no page', { id: EXTENSION_ID }],
  ])('ignores a command from %s (#145)', async (_, sender) => {
    const { kept, sendResponse } = await deliver({ type: 'actor', command: { cmd: 'delete', id: '1' } }, sender);

    expect(kept).toBeUndefined();
    expect(runCommand).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('takes a command from a Xomoni page by its URL when Chrome gives no origin', async () => {
    runCommand.mockResolvedValue({ outcome: 'done' });

    const { kept } = await deliver(
      { type: 'actor', command: { cmd: 'ping' } },
      { id: EXTENSION_ID, url: DASHBOARD.url },
    );

    expect(kept).toBe(true);
    expect(runCommand).toHaveBeenCalledOnce();
  });

  it('runs an actor command and answers with its result, keeping the channel open', async () => {
    runCommand.mockResolvedValue({ outcome: 'done', http: 200 });

    const { kept, sendResponse } = await deliver({ type: 'actor', command: { cmd: 'delete', id: '1' } });

    expect(kept).toBe(true);
    expect(runCommand).toHaveBeenCalledExactlyOnceWith({ cmd: 'delete', id: '1' });
    expect(sendResponse).toHaveBeenCalledExactlyOnceWith({ outcome: 'done', http: 200 });
  });

  it('answers with the error when the command fails', async () => {
    runCommand.mockRejectedValue(new Error('Could not find the post menu'));

    const { sendResponse } = await deliver({ type: 'actor', command: { cmd: 'unlike', id: '2' } });

    expect(sendResponse).toHaveBeenCalledExactlyOnceWith({ error: 'Could not find the post menu' });
  });

  it('answers with the error as text when the command throws something else', async () => {
    runCommand.mockRejectedValue('page went away');

    const { sendResponse } = await deliver({ type: 'actor', command: { cmd: 'scroll' } });

    expect(sendResponse).toHaveBeenCalledExactlyOnceWith({ error: 'page went away' });
  });
});
