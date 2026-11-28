import { describe, expect, it } from 'vitest';
import { ADMIN, AUDIT_JSON, GRACE_ID } from '@test/fakes/admin-console';
import { auditKind, auditTarget, describeAudit, parseAuditLog } from './audit';

describe('parseAuditLog', () => {
  it('reads admin_audit_log(), newest first', () => {
    const entries = parseAuditLog([...AUDIT_JSON].reverse());
    expect(entries.map((e) => e.id)).toEqual([3, 2, 1]);
    expect(entries[1]).toEqual({
      id: 2,
      createdAt: '2026-11-28T09:00:00Z',
      actor: ADMIN.id,
      actorEmail: ADMIN.email,
      action: 'ban',
      target: GRACE_ID,
      targetEmail: 'grace@example.com',
      detail: {},
    });
  });

  it('orders lines of the same moment by id, and tolerates a missing field', () => {
    const entries = parseAuditLog([
      { id: 1, created_at: '2026-11-28T08:00:00Z', action: 'ban' },
      { id: 2, created_at: '2026-11-28T08:00:00Z' },
    ]);
    expect(entries.map((e) => e.id)).toEqual([2, 1]);
    expect(entries[0]).toMatchObject({ action: 'unknown', actor: null, target: null, detail: {} });
    expect(parseAuditLog(null)).toEqual([]);
  });
});

describe('the audit log in plain words', () => {
  it('names each of the database’s actions', () => {
    const [deleted, banned, signedOut] = parseAuditLog(AUDIT_JSON);
    expect(describeAudit(signedOut!)).toBe('Signed out everywhere (3 sessions ended)');
    expect(describeAudit(banned!)).toBe('Suspended the account');
    expect(describeAudit({ action: 'unban', detail: {} })).toBe('Restored the account');
    expect(describeAudit(deleted!)).toBe('Deleted the account');
  });

  it('reads slightly different names the same way', () => {
    expect(auditKind({ action: 'admin_sign_out_user', detail: {} })).toBe('signed-out');
    expect(describeAudit({ action: 'sign_out', detail: {} })).toBe('Signed out everywhere');
    expect(describeAudit({ action: 'sign-out', detail: { count: 1 } })).toBe('Signed out everywhere (1 session ended)');
    expect(auditKind({ action: 'set_banned', detail: { banned: false } })).toBe('restored');
    expect(auditKind({ action: 'set_banned', detail: { banned: true } })).toBe('suspended');
    expect(auditKind({ action: 'user.delete', detail: {} })).toBe('deleted');
    expect(describeAudit({ action: 'export_data', detail: {} })).toBe('Export data');
    expect(describeAudit({ action: '', detail: {} })).toBe('Unknown action');
  });

  it('names the account by its email, a deleted one only by its email’s domain, otherwise by its id', () => {
    const [deleted, banned] = parseAuditLog(AUDIT_JSON);
    expect(auditTarget(banned!)).toBe('grace@example.com');
    expect(auditTarget(deleted!)).toBe('An account at example.org');
    expect(auditTarget({ target: 'u9', targetEmail: null, detail: {} })).toBe('u9');
    expect(auditTarget({ target: null, targetEmail: null, detail: {} })).toBe('—');
  });
});
