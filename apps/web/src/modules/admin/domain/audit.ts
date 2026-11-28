import { asArray, asNumber, asNullableNumber, asNullableString, asObject, asString, type JsonObject } from './json';
import { plural } from './format';

/** One line of the console's audit log: who did what to which account, and when. */
export interface AuditEntry {
  /** The line's id; newer lines have larger ids. */
  readonly id: number;
  /** When it happened. */
  readonly createdAt: string;
  /** The super-admin's user id, or null once their account is gone. */
  readonly actor: string | null;
  /** The super-admin's email, or null once their account is gone. */
  readonly actorEmail: string | null;
  /** What was done, as the database names it: `ban`, `unban`, `sign_out` or `delete`. */
  readonly action: string;
  /** The account acted on, or null once it is gone (a deletion). */
  readonly target: string | null;
  /** That account's email, or null once it is gone. */
  readonly targetEmail: string | null;
  /** More about it, such as how many sessions ended or the domain of a deleted account's email. */
  readonly detail: JsonObject;
}

/** Reads `admin_audit_log()`'s JSON, newest first. */
export function parseAuditLog(json: unknown): AuditEntry[] {
  return asArray(json)
    .map((raw) => {
      const e = asObject(raw);
      return {
        id: asNumber(e.id),
        createdAt: asString(e.created_at),
        actor: asNullableString(e.actor),
        actorEmail: asNullableString(e.actor_email),
        action: asString(e.action, 'unknown'),
        target: asNullableString(e.target),
        targetEmail: asNullableString(e.target_email),
        detail: asObject(e.detail),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

/** The kinds of action the log names in plain words. */
export type AuditKind = 'signed-out' | 'suspended' | 'restored' | 'deleted' | 'other';

/**
 * What kind of action a line records, read from the database's name for it (`ban`, `unban`, `sign_out`, `delete`), so a
 * slightly different name (`sign_out_user`, `set_banned` with `detail.banned`) still reads right.
 */
export function auditKind(entry: Pick<AuditEntry, 'action' | 'detail'>): AuditKind {
  const action = entry.action.toLowerCase().replace(/[^a-z]+/g, '_');
  if (/sign_?out/.test(action)) return 'signed-out';
  if (action.includes('delete')) return 'deleted';
  if (/unban|restore|unsuspend/.test(action)) return 'restored';
  if (/ban|suspend/.test(action)) return entry.detail.banned === false ? 'restored' : 'suspended';
  return 'other';
}

/** An action's name from the database as words: `export_data` → "Export data". */
function humanize(action: string): string {
  const words = action.replace(/[_.-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown action';
}

/** What a line of the log says happened, in plain words: "Signed out everywhere (3 sessions ended)". */
export function describeAudit(entry: Pick<AuditEntry, 'action' | 'detail'>): string {
  switch (auditKind(entry)) {
    case 'signed-out': {
      const ended = asNullableNumber(entry.detail.sessions) ?? asNullableNumber(entry.detail.count);
      return ended === null ? 'Signed out everywhere' : `Signed out everywhere (${plural(ended, 'session')} ended)`;
    }
    case 'suspended':
      return 'Suspended the account';
    case 'restored':
      return 'Restored the account';
    case 'deleted':
      return 'Deleted the account';
    case 'other':
      return humanize(entry.action);
  }
}

/**
 * The account a line is about, in words: its email while it exists; for a deleted one, only the domain of the email it
 * had (all the database keeps of it); otherwise its id.
 */
export function auditTarget(entry: Pick<AuditEntry, 'target' | 'targetEmail' | 'detail'>): string {
  if (entry.targetEmail) return entry.targetEmail;
  const domain = asNullableString(entry.detail.email_domain);
  if (domain) return `An account at ${domain}`;
  return entry.target ?? '—';
}
