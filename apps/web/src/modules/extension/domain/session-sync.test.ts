import type { ExtensionState } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import { type SyncInput, decideSync } from './session-sync';

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const OTHER = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

const fresh: ExtensionState = { version: '0.3.0', connection: null, signedOutAt: null, leftAt: 0 };
const connected = (deviceId: string, connectedAt: number): ExtensionState => ({
  ...fresh,
  connection: { deviceId, account: 'o•••@example.com', connectedAt },
});

function input(over: Partial<SyncInput>): SyncInput {
  return {
    session: { sessionId: 's1', seenAt: 1_000 },
    extension: fresh,
    accountDevices: new Set([MINE]),
    websiteSignedOutAt: 0,
    ...over,
  };
}

describe('decideSync, signed in on the website (#232)', () => {
  it('does nothing when the extension reports as one of the account’s devices', () => {
    expect(decideSync(input({ extension: connected(MINE, 500) }))).toEqual({ kind: 'none' });
    expect(decideSync(input({ extension: connected(MINE, 5_000) }))).toEqual({ kind: 'none' });
  });

  it('signs a fresh extension in', () => {
    expect(decideSync(input({}))).toEqual({ kind: 'sign-in-extension' });
  });

  it('signs an extension signed out before this session in again', () => {
    expect(decideSync(input({ extension: { ...fresh, signedOutAt: 900, leftAt: 900 } }))).toEqual({
      kind: 'sign-in-extension',
    });
  });

  it('switches an extension signed in to another account before this session, naming its device', () => {
    expect(decideSync(input({ extension: connected(OTHER, 500) }))).toEqual({
      kind: 'sign-in-extension',
      replace: OTHER,
    });
  });

  it('signs the website out when the person left xomoni.com in the extension after this session started', () => {
    expect(decideSync(input({ extension: { ...fresh, leftAt: 1_001 } }))).toEqual({ kind: 'sign-out-website' });
    expect(decideSync(input({ extension: { ...fresh, signedOutAt: 2_000, leftAt: 2_000 } }))).toEqual({
      kind: 'sign-out-website',
    });
  });

  it('signs the website out when the extension signed in to another account after this session started', () => {
    expect(decideSync(input({ extension: connected(OTHER, 1_500) }))).toEqual({ kind: 'sign-out-website' });
  });

  it('counts a tie as the website’s: leaving at the same moment doesn’t sign it out', () => {
    expect(decideSync(input({ extension: { ...fresh, leftAt: 1_000 } }))).toEqual({ kind: 'sign-in-extension' });
  });
});

describe('decideSync, signed out on the website (#232)', () => {
  const signedOut = (over: Partial<SyncInput>) => input({ session: null, accountDevices: new Set(), ...over });

  it('signs the extension out when the website signed out after it signed in', () => {
    expect(decideSync(signedOut({ extension: connected(MINE, 500), websiteSignedOutAt: 600 }))).toEqual({
      kind: 'sign-out-extension',
    });
  });

  it('leaves an extension signed in after the website’s sign-out: the person may sign in here again', () => {
    expect(decideSync(signedOut({ extension: connected(MINE, 700), websiteSignedOutAt: 600 }))).toEqual({
      kind: 'none',
    });
  });

  it('leaves an extension without an account alone, whatever happened on the website', () => {
    expect(decideSync(signedOut({ websiteSignedOutAt: 600 }))).toEqual({ kind: 'none' });
    expect(decideSync(signedOut({}))).toEqual({ kind: 'none' });
  });
});
