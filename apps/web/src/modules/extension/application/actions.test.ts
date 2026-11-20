import { describe, expect, it, vi } from 'vitest';
import { askXomoni, changeXomoniSettings, readXomoni } from './actions';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';

function deps(extensionId: string | null) {
  return {
    channel: {
      job: vi.fn(() => Promise.resolve({ ok: true as const, outcome: 'stopping' as const })),
      open: vi.fn(() => Promise.resolve({ ok: true as const, outcome: 'opened' as const })),
      read: vi.fn(() => Promise.resolve({ ok: true as const, what: 'watch' as const, tabs: [] })),
      settings: vi.fn(() => Promise.resolve({ ok: false as const, reason: 'signed_out' as const })),
    },
    memory: { extensionId: () => extensionId },
  };
}

describe('askXomoni (ADR-0027, #251)', () => {
  it('sends nothing when the site doesn’t know the extension', async () => {
    const d = deps(null);
    await expect(askXomoni(d, { kind: 'open', page: 'library', deviceId: DEVICE })).resolves.toEqual({
      ok: false,
      reason: 'no_answer',
    });
    expect(d.channel.job).not.toHaveBeenCalled();
    expect(d.channel.open).not.toHaveBeenCalled();
  });

  it('hands a job action, with its device and job, to the extension it knows', async () => {
    const d = deps(EXT);
    await expect(askXomoni(d, { kind: 'job', action: 'pause', deviceId: DEVICE, jobId: 'job-1' })).resolves.toEqual({
      ok: true,
      outcome: 'stopping',
    });
    expect(d.channel.job).toHaveBeenCalledWith(EXT, { action: 'pause', deviceId: DEVICE, jobId: 'job-1' });
  });

  it('asks it to open a page', async () => {
    const d = deps(EXT);
    await expect(askXomoni(d, { kind: 'open', page: 'settings', deviceId: DEVICE })).resolves.toEqual({
      ok: true,
      outcome: 'opened',
    });
    expect(d.channel.open).toHaveBeenCalledWith(EXT, { page: 'settings', deviceId: DEVICE });
  });
});

describe('readXomoni (ADR-0028, #233)', () => {
  it('reads from the extension it knows, and sends nothing without one', async () => {
    const d = deps(EXT);
    await expect(readXomoni(d, { what: 'watch', deviceId: DEVICE })).resolves.toEqual({
      ok: true,
      what: 'watch',
      tabs: [],
    });
    expect(d.channel.read).toHaveBeenCalledWith(EXT, { what: 'watch', deviceId: DEVICE });
    const none = deps(null);
    await expect(readXomoni(none, { what: 'health', deviceId: DEVICE })).resolves.toEqual({
      ok: false,
      reason: 'no_answer',
    });
    expect(none.channel.read).not.toHaveBeenCalled();
  });
});

describe('changeXomoniSettings (ADR-0029, #234)', () => {
  it('hands the change to the extension it knows, and sends nothing without one', async () => {
    const d = deps(EXT);
    const change = { deviceId: DEVICE, change: { notifications: false } };
    await expect(changeXomoniSettings(d, change)).resolves.toEqual({ ok: false, reason: 'signed_out' });
    expect(d.channel.settings).toHaveBeenCalledWith(EXT, change);
    const none = deps(null);
    await expect(changeXomoniSettings(none, change)).resolves.toEqual({ ok: false, reason: 'no_answer' });
    expect(none.channel.settings).not.toHaveBeenCalled();
  });
});
