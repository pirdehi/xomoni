import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceRow, fakeSupabase, jobRow, type FakeSupabase } from '@test/server-helpers';
import { createServerSupabase } from '@/shared/supabase/server';
import { loadDashboardSnapshot } from './load';

vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: vi.fn() }));

let supabase: FakeSupabase;

beforeEach(() => {
  supabase = fakeSupabase();
  vi.mocked(createServerSupabase).mockReset().mockResolvedValue(supabase.client);
});

describe('loadDashboardSnapshot', () => {
  it('reads the signed-in person’s devices and jobs through the request-bound client', async () => {
    supabase.respond('devices', { data: [deviceRow()], error: null });
    supabase.respond('jobs', { data: [jobRow({ kind: 'scan', scanned: 120 })], error: null });

    const snapshot = await loadDashboardSnapshot();

    expect(createServerSupabase).toHaveBeenCalledOnce();
    expect(snapshot.devices).toEqual([
      { id: 'd1', name: 'Chrome on macOS', extensionVersion: '0.2.0', lastSeenAt: '2026-10-31T11:00:00Z' },
    ]);
    expect(snapshot.jobs).toMatchObject([{ id: 'j1', kind: 'scan', scanned: 120, deviceId: 'd1' }]);
  });

  it('leaves scoping to Row Level Security: it never filters by a user id it was handed', async () => {
    await loadDashboardSnapshot();

    for (const query of supabase.queries) {
      expect(query.calls.filter(([method]) => method === 'eq')).toEqual([]);
    }
    expect(supabase.queries.map((q) => q.table).sort()).toEqual(['devices', 'jobs']);
  });

  it('asks for at most the 50 most recent jobs', async () => {
    await loadDashboardSnapshot();

    const jobs = supabase.queries.find((q) => q.table === 'jobs');
    expect(jobs?.calls).toContainEqual(['limit', [50]]);
  });

  it('fails the page when a read fails, instead of showing an empty dashboard', async () => {
    supabase.respond('devices', { data: null, error: { message: 'JWT expired' } });

    await expect(loadDashboardSnapshot()).rejects.toThrow('devices: JWT expired');
  });

  it('uses a new client for every request', async () => {
    await loadDashboardSnapshot();
    await loadDashboardSnapshot();
    expect(createServerSupabase).toHaveBeenCalledTimes(2);
  });
});
