import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PASSWORD_POLICY, passwordIssues, signUpSchema, validate } from './credentials';

describe('passwordIssues', () => {
  it('accepts a long password with a letter and a digit', () => {
    expect(passwordIssues('correct horse 42')).toEqual([]);
  });

  it('lists every rule that is not met', () => {
    expect(passwordIssues('short')).toEqual(['too_short', 'needs_digit']);
    expect(passwordIssues('1234567890')).toEqual(['needs_letter']);
    expect(passwordIssues('abcdefghij')).toEqual(['needs_digit']);
  });

  it('counts bytes, not characters, against the 72-byte bcrypt limit', () => {
    expect(passwordIssues(`a1${'x'.repeat(70)}`)).toEqual([]);
    expect(passwordIssues(`a1${'é'.repeat(36)}`)).toEqual(['too_long']);
  });
});

describe('signUpSchema', () => {
  it('trims and lowercases the email and drops an empty name', () => {
    expect(validate(signUpSchema, { name: '  ', email: ' Ada@Example.COM ', password: 'correct horse 42' })).toEqual({
      ok: true,
      value: { name: undefined, email: 'ada@example.com', password: 'correct horse 42' },
    });
  });

  it('reports one message per field', () => {
    const result = validate(signUpSchema, { email: 'not-an-email', password: 'abc' });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { email: 'Enter a valid email address', password: 'Password needs: at least 10 characters' },
    });
  });

  it('treats missing fields as errors, not crashes', () => {
    expect(validate(signUpSchema, {})).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
  });
});

describe('policy matches supabase/config.toml', () => {
  // The website shows the same rule that Supabase Auth enforces; this fails if they drift apart.
  const config = readFileSync(join(__dirname, '../../../../../../supabase/config.toml'), 'utf8');
  const auth = config.slice(config.indexOf('\n[auth]\n'));

  it('uses the same minimum length', () => {
    expect(auth).toMatch(new RegExp(`^minimum_password_length = ${PASSWORD_POLICY.minLength}$`, 'm'));
  });

  it('requires letters and digits', () => {
    expect(auth).toMatch(/^password_requirements = "letters_digits"$/m);
  });
});

describe('zod under the site CSP (ADR-0014)', () => {
  it('runs without eval, so the browser never reports a blocked `new Function` probe', () => {
    expect(z.config().jitless).toBe(true);
  });
});
