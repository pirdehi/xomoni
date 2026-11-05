import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL } from './site';

// public/.well-known/security.txt (RFC 9116, #150): where to report a vulnerability. Its `Expires` must be renewed
// at least yearly; this test starts failing 30 days before it lapses, so the reminder comes in time.
const FILE = path.join(__dirname, '..', '..', '..', 'public', '.well-known', 'security.txt');
const text = readFileSync(FILE, 'utf8');

const DAY = 24 * 60 * 60 * 1000;

/** The file's fields, in order, ignoring comments and blank lines. */
const fields = text
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#'))
  .map((line) => {
    const match = /^([A-Za-z-]+): (.+)$/.exec(line);
    expect(match, `"${line}" isn't "Field: value"`).not.toBeNull();
    return { name: match![1]!, value: match![2]! };
  });
const values = (name: string) => fields.filter((field) => field.name === name).map((field) => field.value);

describe('security.txt (#150)', () => {
  it('uses only RFC 9116 fields', () => {
    const known = ['Acknowledgments', 'Canonical', 'Contact', 'Encryption', 'Expires', 'Hiring', 'Policy'];
    for (const { name } of fields) expect([...known, 'Preferred-Languages']).toContain(name);
  });

  it('points to the same private channels as SECURITY.md', () => {
    expect(values('Contact')).toEqual([
      `mailto:${CONTACT_EMAIL}`,
      'https://github.com/pirdehi/xomoni/security/advisories/new',
    ]);
    expect(values('Policy')).toEqual(['https://github.com/pirdehi/xomoni/blob/main/SECURITY.md']);
    expect(values('Preferred-Languages')).toEqual(['en, fa']);
    expect(values('Canonical')).toEqual(['https://xomoni.com/.well-known/security.txt']);
  });

  it('expires once, at most a year ahead, and not within the next 30 days', () => {
    const expires = values('Expires');
    expect(expires).toHaveLength(1);
    expect(expires[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const at = Date.parse(expires[0]!);
    expect(at, 'renew Expires in public/.well-known/security.txt').toBeGreaterThan(Date.now() + 30 * DAY);
    expect(at).toBeLessThanOrEqual(Date.now() + 366 * DAY);
  });
});
