import type { ExtensionState } from '@xomoni/bridge';
import { describe, expect, it, vi } from 'vitest';
import type { AccountSession, BrowserMemory, ExtensionChannel, SyncLock } from './ports';
import { type SyncDeps, signOutBoth, syncSession } from './session-sync';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const OTHER = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const NOW = 10_000;

const fresh: ExtensionState = { version: '0.3.0', connection: null, signedOutAt: null, leftAt: 0 };
const connected = (deviceId: string, connectedAt: number): ExtensionState => ({
  ...fresh,
  connection: { deviceId, account: 'o•••@example.com', connectedAt },
});

/** Fakes for every port. The session `s1` was first seen at `seenAt`; the memory knows `extensionId`. */
function deps(
  options: {
    state?: ExtensionState | null;
    sessionId?: string | null;
    seenAt?: number;
    extensionId?: string | null;
    devices?: string[];
    code?: string | null;
    signedOutAt?: number;
    fixedIds?: string[];
    /** Answers per id, for a hello to several (#302); `state` answers every other id. */
    states?: Record<string, ExtensionState | null>;
  } = {},
) {
  const seen = new Map<string, number>([['s1', options.seenAt ?? 5_000]]);
  const memory: BrowserMemory = {
    extensionId: vi.fn(() => (options.extensionId === undefined ? EXT : options.extensionId)),
    rememberExtension: vi.fn(),
    websiteSignedOutAt: vi.fn(() => options.signedOutAt ?? 0),
    rememberSignOut: vi.fn(),
    sessionSeenAt: vi.fn((id: string, now: number) => {
      if (!seen.has(id)) seen.set(id, now);
      return seen.get(id)!;
    }),
  };
  const channel: ExtensionChannel = {
    hello: vi.fn((id: string) =>
      Promise.resolve(
        options.states && id in options.states
          ? (options.states[id] ?? null)
          : options.state === undefined
            ? fresh
            : options.state,
      ),
    ),
    signIn: vi.fn(() => Promise.resolve({ ok: true as const, account: 'o•••@example.com', deviceId: MINE })),
    signOut: vi.fn(() => Promise.resolve({ ok: true as const, signedOut: true })),
  };
  const account: AccountSession = {
    currentSessionId: vi.fn(() => Promise.resolve(options.sessionId === undefined ? 's1' : options.sessionId)),
    deviceIds: vi.fn(() => Promise.resolve(new Set(options.devices ?? [MINE]))),
    createCode: vi.fn(() => Promise.resolve(options.code === undefined ? 'ABCDE-FGHJK' : options.code)),
    signOut: vi.fn(() => Promise.resolve()),
  };
  const lock: SyncLock = { run: vi.fn((task: () => Promise<unknown>) => task()) as SyncLock['run'] };
  return { channel, memory, account, lock, fixedIds: options.fixedIds ?? [] } satisfies SyncDeps;
}

describe('syncSession (#232)', () => {
  it('signs a fresh extension in with a code of the signed-in account, under the lock', async () => {
    const d = deps();

    expect(await syncSession(d, NOW)).toEqual({
      kind: 'extension-signed-in',
      extensionId: EXT,
      account: 'o•••@example.com',
      deviceId: MINE,
    });
    expect(d.channel.signIn).toHaveBeenCalledWith(EXT, { code: 'ABCDE-FGHJK' });
    expect(d.lock.run).toHaveBeenCalledTimes(1);
    // No device list is needed when the extension has no connection.
    expect(d.account.deviceIds).not.toHaveBeenCalled();
  });

  it('switches an extension signed in to another account earlier, naming its device', async () => {
    const d = deps({ state: connected(OTHER, 1_000) });

    await syncSession(d, NOW);

    expect(d.channel.signIn).toHaveBeenCalledWith(EXT, { code: 'ABCDE-FGHJK', replace: OTHER });
  });

  it('is in step when the extension reports as one of the account’s devices', async () => {
    const state = connected(MINE, 1_000);
    const d = deps({ state });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'in-step', extensionId: EXT, state });
    expect(d.account.createCode).not.toHaveBeenCalled();
    expect(d.channel.signIn).not.toHaveBeenCalled();
  });

  it('signs the website out when the person left xomoni.com in the extension after this session started', async () => {
    const d = deps({ state: { ...fresh, leftAt: 6_000 }, seenAt: 5_000 });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'website-signed-out', extensionId: EXT });
    expect(d.account.signOut).toHaveBeenCalled();
    expect(d.channel.signIn).not.toHaveBeenCalled();
  });

  it('counts a session it never saw as starting now, so an earlier sign-out in the extension doesn’t end it', async () => {
    const d = deps({ state: { ...fresh, leftAt: 6_000 }, sessionId: 's2' });

    expect(await syncSession(d, NOW)).toMatchObject({ kind: 'extension-signed-in' });
    expect(d.memory.sessionSeenAt).toHaveBeenCalledWith('s2', NOW);
  });

  it('signs the extension out when the website signed out after it signed in', async () => {
    const d = deps({ sessionId: null, state: connected(MINE, 1_000), signedOutAt: 2_000 });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'extension-signed-out', extensionId: EXT });
    expect(d.channel.signOut).toHaveBeenCalledWith(EXT);
    expect(d.account.deviceIds).not.toHaveBeenCalled();
  });

  it('keeps the session’s first sighting even before the site knows the extension', async () => {
    const d = deps({ extensionId: null, sessionId: 's3' });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'no-extension' });
    expect(d.memory.sessionSeenAt).toHaveBeenCalledWith('s3', NOW);
    expect(d.channel.hello).not.toHaveBeenCalled();
  });

  it('says unreachable when the extension doesn’t answer, and does nothing else', async () => {
    const d = deps({ state: null });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'unreachable' });
    expect(d.account.createCode).not.toHaveBeenCalled();
  });

  it('says why the extension didn’t sign in: no code, or its refusal', async () => {
    expect(await syncSession(deps({ code: null }), NOW)).toEqual({
      kind: 'extension-not-signed-in',
      extensionId: EXT,
      reason: 'code',
    });

    const d = deps();
    vi.mocked(d.channel.signIn).mockResolvedValueOnce({ ok: false, reason: 'device_limit' });
    expect(await syncSession(d, NOW)).toEqual({
      kind: 'extension-not-signed-in',
      extensionId: EXT,
      reason: 'device_limit',
    });
  });
});

describe('syncSession with a fixed id (#302)', () => {
  const CHROME = 'ponmlkjihgfedcbaponmlkjihgfedcba';
  const EDGE = 'aaaabbbbccccddddeeeeffffgggghhhh';

  it('finds Xomoni at a store’s id without #ext=, and signs it in there', async () => {
    const d = deps({ extensionId: null, fixedIds: [CHROME, EDGE], states: { [CHROME]: fresh, [EDGE]: null } });

    expect(await syncSession(d, NOW)).toEqual({
      kind: 'extension-signed-in',
      extensionId: CHROME,
      account: 'o•••@example.com',
      deviceId: MINE,
    });
    expect(d.channel.hello).toHaveBeenCalledWith(CHROME);
    expect(d.channel.hello).toHaveBeenCalledWith(EDGE);
    expect(d.channel.signIn).toHaveBeenCalledWith(CHROME, { code: 'ABCDE-FGHJK' });
  });

  it('signs out the copy it found, at its id', async () => {
    const d = deps({
      extensionId: null,
      sessionId: null,
      signedOutAt: 2_000,
      fixedIds: [CHROME, EDGE],
      states: { [CHROME]: null, [EDGE]: connected(MINE, 1_000) },
    });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'extension-signed-out', extensionId: EDGE });
    expect(d.channel.signOut).toHaveBeenCalledWith(EDGE);
  });

  it('prefers the id a page of Xomoni named, when both answer', async () => {
    const d = deps({ fixedIds: [CHROME], states: { [EXT]: fresh, [CHROME]: fresh } });

    expect(await syncSession(d, NOW)).toMatchObject({ kind: 'extension-signed-in', extensionId: EXT });
    expect(d.channel.signIn).toHaveBeenCalledWith(EXT, { code: 'ABCDE-FGHJK' });
  });

  it('falls back to a store’s id when the named one doesn’t answer (a zip install removed)', async () => {
    const state = connected(MINE, 1_000);
    const d = deps({ fixedIds: [CHROME], states: { [EXT]: null, [CHROME]: state } });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'in-step', extensionId: CHROME, state });
  });

  it('says no extension when only fixed ids were asked and none answered, unreachable when a named one was', async () => {
    const none = deps({ extensionId: null, fixedIds: [CHROME, EDGE], state: null });
    expect(await syncSession(none, NOW)).toEqual({ kind: 'no-extension' });
    expect(none.lock.run).toHaveBeenCalledTimes(1);
    expect(none.account.createCode).not.toHaveBeenCalled();

    expect(await syncSession(deps({ fixedIds: [CHROME], state: null }), NOW)).toEqual({ kind: 'unreachable' });
  });

  it('asks nothing, and takes no lock, while it knows no id at all', async () => {
    const d = deps({ extensionId: null, fixedIds: [] });

    expect(await syncSession(d, NOW)).toEqual({ kind: 'no-extension' });
    expect(d.lock.run).not.toHaveBeenCalled();
    expect(d.channel.hello).not.toHaveBeenCalled();
  });
});

describe('signOutBoth (#232)', () => {
  it('remembers the sign-out and signs the extension out too', async () => {
    const d = deps();

    await signOutBoth({ ...d, answeredAt: null }, NOW);

    expect(d.memory.rememberSignOut).toHaveBeenCalledWith(NOW);
    expect(d.channel.signOut).toHaveBeenCalledWith(EXT);
  });

  it('only remembers it when the site doesn’t know the extension; a later sync catches up', async () => {
    const d = deps({ extensionId: null });

    await signOutBoth({ ...d, answeredAt: null }, NOW);

    expect(d.memory.rememberSignOut).toHaveBeenCalledWith(NOW);
    expect(d.channel.hello).not.toHaveBeenCalled();
    expect(d.channel.signOut).not.toHaveBeenCalled();
  });

  it('signs out the copy the page’s last sync found, without asking again (#302)', async () => {
    const CHROME = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    const d = deps({ fixedIds: [CHROME] });

    await signOutBoth({ ...d, answeredAt: CHROME }, NOW);

    expect(d.channel.hello).not.toHaveBeenCalled();
    expect(d.channel.signOut).toHaveBeenCalledWith(CHROME);
  });

  it('before the page’s first sync ended, finds the copy at a fixed id and signs that out (#302)', async () => {
    const CHROME = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    const found = deps({ extensionId: null, fixedIds: [CHROME], states: { [CHROME]: connected(MINE, 1_000) } });
    await signOutBoth({ ...found, answeredAt: null }, NOW);
    expect(found.channel.signOut).toHaveBeenCalledWith(CHROME);

    const none = deps({ extensionId: null, fixedIds: [CHROME], state: null });
    await signOutBoth({ ...none, answeredAt: null }, NOW);
    expect(none.memory.rememberSignOut).toHaveBeenCalledWith(NOW);
    expect(none.channel.signOut).not.toHaveBeenCalled();
  });
});
