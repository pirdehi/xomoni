/**
 * Why an action on an account didn't happen: the database refused it, the account is gone, it is the super-admin's own
 * or another super-admin's, the typed email didn't match, or something failed.
 */
export type AdminProblem = 'forbidden' | 'not-found' | 'self' | 'superadmin' | 'confirm-mismatch' | 'failed';

/** The words a super-admin reads for each {@link AdminProblem}. */
export const ADMIN_PROBLEM_MESSAGES: Readonly<Record<AdminProblem, string>> = {
  forbidden:
    'The database refused this. Only a super-admin may do it, with two-step verification done when their account has an authenticator app.',
  'not-found': 'That account no longer exists.',
  self: 'You can’t do this to your own account here. Use your account page.',
  superadmin: 'You can’t do this to another super-admin’s account.',
  'confirm-mismatch': 'Type the account’s email exactly as shown to delete it.',
  failed: 'That didn’t work. Try again in a moment.',
};

/** A failure of the console's store, with the problem to show and the database's own words for the logs. */
export class AdminError extends Error {
  /** What to tell the super-admin. */
  readonly problem: AdminProblem;

  constructor(problem: AdminProblem, detail: string) {
    super(detail);
    this.name = 'AdminError';
    this.problem = problem;
  }
}

/** The problem behind any error the store threw: its own, or `failed` for anything unexpected. */
export function problemOf(error: unknown): AdminProblem {
  return error instanceof AdminError ? error.problem : 'failed';
}
