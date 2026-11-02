import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceRow, fakeSupabase, type FakeSupabase } from '@test/server-helpers';
import { createBrowserSupabase } from '@/shared/supabase/browser';
import { createLiveDashboardServices } from './live';

vi.mock('@/shared/supabase/browser', () => ({ createBrowserSupabase: vi.fn() }));

let supabase: FakeSupabase;

beforeEach(() => {
  supabase = fakeSupabase();
  vi.mocked(createBrowserSupabase).mockReset().mockReturnValue(supabase.client);
});

describe('createLiveDashboardServices (browser composition root)', () => {
  it('builds every port on one browser client', () => {
    const services = createLiveDashboardServices();
    expect(createBrowserSupabase).toHaveBeenCalledOnce();
    expect(Object.keys(services).sort()).toEqual(['feed', 'pairing', 'reader', 'registry']);
  });

  it('re-reads devices through the browser client', async () => {
    supabase.respond('devices', { data: [deviceRow()], error: null });

    const { reader } = createLiveDashboardServices();

    expect(await reader.listDevices()).toMatchObject([{ id: 'd1' }]);
    expect(supabase.from).toHaveBeenCalledWith('devices');
  });

  it('disconnects a device through the browser client', async () => {
    const { registry } = createLiveDashboardServices();

    expect(await registry.disconnect('d1')).toEqual({ ok: true });
    expect(supabase.queries).toEqual([
      {
        table: 'devices',
        calls: [
          ['delete', []],
          ['eq', ['id', 'd1']],
        ],
      },
    ]);
  });

  it('streams changes on the viewer’s private channel through the browser client', async () => {
    const { feed } = createLiveDashboardServices();

    const stop = feed.subscribe('u1', { onJob: vi.fn(), onDevice: vi.fn(), onStatus: vi.fn() });
    await supabase.authLoaded;

    expect(supabase.channels.map((c) => c.topic)).toEqual(['dashboard:u1']);
    stop();
  });
});
