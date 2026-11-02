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

let listener: Listener;
let listeners = 0;

beforeAll(async () => {
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } });
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
async function deliver(message: unknown) {
  const sendResponse = vi.fn<SendResponse>();
  const kept = listener(message, { id: 'test-extension' }, sendResponse);
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
