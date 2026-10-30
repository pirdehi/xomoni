import type { JobRow } from '@xomoni/db';
import { describe, expect, it } from 'vitest';
import { toDevice, toJobSummary } from './supabase-dashboard';

describe('row mappers', () => {
  it('maps a job row to the domain model', () => {
    const row: JobRow = {
      id: 'j1', user_id: 'u1', device_id: 'd1', local_id: 'job-1', x_handle: 'ada', kind: 'cleanup',
      title: 'Delete posts before 2024', state: 'running', phase: 'Sweeping', state_reason: '',
      matched: 10, done: 3, skipped: 1, failed: 0, scanned: 0,
      started_at: null, finished_at: null, created_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T11:00:00Z',
    };
    expect(toJobSummary(row)).toEqual({
      id: 'j1', deviceId: 'd1', xHandle: 'ada', kind: 'cleanup', title: 'Delete posts before 2024', state: 'running',
      phase: 'Sweeping', stateReason: '', matched: 10, done: 3, skipped: 1, failed: 0, scanned: 0,
      updatedAt: '2026-10-31T11:00:00Z',
    });
  });

  it('maps a device row', () => {
    expect(
      toDevice({ id: 'd1', user_id: 'u1', name: 'Chrome on macOS', extension_version: '0.2.0', created_at: 'c', last_seen_at: 'l' }),
    ).toEqual({ id: 'd1', name: 'Chrome on macOS', extensionVersion: '0.2.0', lastSeenAt: 'l' });
  });
});
