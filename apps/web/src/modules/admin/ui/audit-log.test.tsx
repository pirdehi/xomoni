// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AUDIT_JSON, GRACE_ID } from '@test/fakes/admin-console';
import { parseAuditLog } from '../domain/audit';
import { AuditLog } from './audit-log';

describe('AuditLog (#516)', () => {
  it('lists what super-admins did, newest first, in plain words', () => {
    render(<AuditLog entries={parseAuditLog(AUDIT_JSON)} />);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2]?.textContent)).toEqual([
      'Deleted the account',
      'Suspended the account',
      'Signed out everywhere (3 sessions ended)',
    ]);
    expect(rows[0]).toHaveTextContent('28 Nov 2026, 10:00 UTC');
    expect(rows[0]).toHaveTextContent('maintainer@example.com');
    expect(rows[0]).toHaveTextContent('An account at example.org');
    expect(within(rows[1]!).getByRole('link', { name: 'grace@example.com' })).toHaveAttribute(
      'href',
      `/product/users/${GRACE_ID}`,
    );
  });

  it('says when nothing happened yet, and when it couldn’t load', () => {
    const { rerender } = render(<AuditLog entries={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing yet');
    rerender(<AuditLog entries={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load the audit log.');
  });

  it('names an actor whose account is gone by id, or not at all', () => {
    render(
      <AuditLog
        entries={parseAuditLog([{ id: 1, created_at: '2026-11-28T08:00:00Z', action: 'unban', actor: 'gone-id' }])}
      />,
    );
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('gone-id');
    expect(row).toHaveTextContent('Restored the account');
  });
});
