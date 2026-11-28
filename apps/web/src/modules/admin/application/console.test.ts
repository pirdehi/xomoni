import { describe, expect, it, vi } from 'vitest';
import { ADMIN, GRACE_ID, USER_JSON, fakeConsoleStore } from '@test/fakes/admin-console';
import { AdminError } from '../domain/problems';
import { parseUserDetail } from '../domain/users';
import { AUDIT_LOG_LIMIT, deleteAccount, setSuspended, signOutEverywhere } from './console';

const OTHER_ADMIN = 'c0000000-0000-4000-8000-000000000003';

function store(overrides: Parameters<typeof fakeConsoleStore>[0] = {}) {
  return fakeConsoleStore({
    user: vi.fn((id: string) =>
      Promise.resolve(
        id === GRACE_ID
          ? parseUserDetail(USER_JSON)
          : id === OTHER_ADMIN
            ? parseUserDetail({ ...USER_JSON, id: OTHER_ADMIN, superadmin: true })
            : id === ADMIN.id
              ? parseUserDetail({ ...USER_JSON, id: ADMIN.id, email: ADMIN.email, superadmin: true })
              : null,
      ),
    ),
    ...overrides,
  });
}

describe('signOutEverywhere', () => {
  it('ends every session of the account and says how many', async () => {
    const s = store();
    expect(await signOutEverywhere(s, ADMIN.id, GRACE_ID)).toEqual({ ok: true, value: 3 });
    expect(s.signOutUser).toHaveBeenCalledWith(GRACE_ID);
  });

  it('refuses the super-admin’s own account without asking the database anything', async () => {
    const s = store();
    expect(await signOutEverywhere(s, ADMIN.id, ADMIN.id)).toMatchObject({ ok: false, problem: 'self' });
    expect(s.user).not.toHaveBeenCalled();
    expect(s.signOutUser).not.toHaveBeenCalled();
  });

  it('refuses another super-admin’s account and an account that is gone', async () => {
    const s = store();
    expect(await signOutEverywhere(s, ADMIN.id, OTHER_ADMIN)).toMatchObject({ ok: false, problem: 'superadmin' });
    expect(await signOutEverywhere(s, ADMIN.id, 'gone')).toMatchObject({ ok: false, problem: 'not-found' });
    expect(s.signOutUser).not.toHaveBeenCalled();
  });

  it('passes the database’s refusal on as its problem, with the detail for the logs', async () => {
    const s = store({
      signOutUser: vi.fn(() => Promise.reject(new AdminError('forbidden', 'admin_sign_out_user: Not allowed.'))),
    });
    expect(await signOutEverywhere(s, ADMIN.id, GRACE_ID)).toEqual({
      ok: false,
      problem: 'forbidden',
      detail: 'admin_sign_out_user: Not allowed.',
    });
  });

  it('reads an unexpected failure as failed', async () => {
    const s = store({ user: vi.fn(() => Promise.reject(new Error('network down'))) });
    expect(await signOutEverywhere(s, ADMIN.id, GRACE_ID)).toEqual({
      ok: false,
      problem: 'failed',
      detail: 'network down',
    });
    const t = store({ user: vi.fn().mockRejectedValue('odd') });
    expect(await signOutEverywhere(t, ADMIN.id, GRACE_ID)).toEqual({ ok: false, problem: 'failed', detail: 'odd' });
  });
});

describe('setSuspended', () => {
  it('suspends and restores an account', async () => {
    const s = store();
    expect(await setSuspended(s, ADMIN.id, GRACE_ID, true)).toEqual({ ok: true, value: null });
    expect(await setSuspended(s, ADMIN.id, GRACE_ID, false)).toEqual({ ok: true, value: null });
    expect(s.setBanned.mock.calls).toEqual([
      [GRACE_ID, true],
      [GRACE_ID, false],
    ]);
  });

  it('never suspends oneself or another super-admin', async () => {
    const s = store();
    expect(await setSuspended(s, ADMIN.id, ADMIN.id, true)).toMatchObject({ problem: 'self' });
    expect(await setSuspended(s, ADMIN.id, OTHER_ADMIN, true)).toMatchObject({ problem: 'superadmin' });
    expect(s.setBanned).not.toHaveBeenCalled();
  });

  it('reports an account the database no longer has', async () => {
    const s = store({ setBanned: vi.fn(() => Promise.reject(new AdminError('not-found', 'No such account.'))) });
    expect(await setSuspended(s, ADMIN.id, GRACE_ID, true)).toMatchObject({ ok: false, problem: 'not-found' });
  });
});

describe('deleteAccount', () => {
  it('deletes the account once its email is typed exactly', async () => {
    const s = store();
    expect(await deleteAccount(s, ADMIN.id, GRACE_ID, ' grace@example.com ')).toEqual({ ok: true, value: null });
    expect(s.deleteUser).toHaveBeenCalledWith(GRACE_ID);
  });

  it('deletes nothing when the typed email differs in any way', async () => {
    const s = store();
    for (const typed of ['Grace@example.com', 'grace@example.co', '', 'grace']) {
      expect(await deleteAccount(s, ADMIN.id, GRACE_ID, typed)).toMatchObject({ problem: 'confirm-mismatch' });
    }
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes nothing of an account without an email, whatever is typed', async () => {
    const s = store({ user: vi.fn(() => Promise.resolve(parseUserDetail({ ...USER_JSON, email: '' }))) });
    expect(await deleteAccount(s, ADMIN.id, GRACE_ID, '')).toMatchObject({ problem: 'confirm-mismatch' });
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it('never deletes oneself or another super-admin', async () => {
    const s = store();
    expect(await deleteAccount(s, ADMIN.id, ADMIN.id, ADMIN.email)).toMatchObject({ problem: 'self' });
    expect(await deleteAccount(s, ADMIN.id, OTHER_ADMIN, 'grace@example.com')).toMatchObject({ problem: 'superadmin' });
    expect(s.deleteUser).not.toHaveBeenCalled();
  });
});

describe('AUDIT_LOG_LIMIT', () => {
  it('shows the newest 50 lines, within what admin_audit_log() takes', () => {
    expect(AUDIT_LOG_LIMIT).toBe(50);
  });
});
