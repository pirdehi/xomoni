import { describe, expect, it } from 'vitest';
import { ADMIN_PROBLEM_MESSAGES, AdminError, problemOf } from './problems';

describe('console problems', () => {
  it('carry their problem and the database’s words for the logs', () => {
    const error = new AdminError('forbidden', 'admin_users: Not allowed.');
    expect(error).toBeInstanceOf(Error);
    expect(error.problem).toBe('forbidden');
    expect(error.message).toBe('admin_users: Not allowed.');
    expect(problemOf(error)).toBe('forbidden');
  });

  it('read anything else as failed', () => {
    expect(problemOf(new Error('network'))).toBe('failed');
    expect(problemOf('x')).toBe('failed');
  });

  it('have plain words for every problem, none naming a database code', () => {
    for (const message of Object.values(ADMIN_PROBLEM_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/42501|P0002|SQL/);
    }
  });
});
