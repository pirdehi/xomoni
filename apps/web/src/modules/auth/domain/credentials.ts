import { z } from 'zod';

/**
 * Password rules. They mirror `minimum_password_length` and `password_requirements = "letters_digits"`
 * in `supabase/config.toml`, so people see the same rule here that Supabase enforces; a unit test
 * fails if the two drift apart. Length is capped at 72 bytes because bcrypt ignores the rest.
 */
export const PASSWORD_POLICY = { minLength: 10, maxBytes: 72 } as const;

/** Ways a new password can fall short, in the order people should fix them. */
export type PasswordIssue = 'too_short' | 'too_long' | 'needs_letter' | 'needs_digit';

/** One short requirement per issue, used for the live checklist and for error messages. */
export const PASSWORD_REQUIREMENTS: Record<PasswordIssue, string> = {
  too_short: `At least ${PASSWORD_POLICY.minLength} characters`,
  too_long: 'No more than 72 characters',
  needs_letter: 'At least one letter (a–z)',
  needs_digit: 'At least one number (0–9)',
};

/** Lists what a new password is missing; an empty list means it meets the policy. */
export function passwordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_POLICY.minLength) issues.push('too_short');
  if (new TextEncoder().encode(password).length > PASSWORD_POLICY.maxBytes) issues.push('too_long');
  if (!/[A-Za-z]/.test(password)) issues.push('needs_letter');
  if (!/[0-9]/.test(password)) issues.push('needs_digit');
  return issues;
}

const email = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address')
  .max(254, 'That email address is too long')
  .pipe(z.email('Enter a valid email address'));

const newPassword = z.string({ error: 'Choose a password' }).superRefine((password, ctx) => {
  const [first] = passwordIssues(password);
  if (first) ctx.addIssue({ code: 'custom', message: `Password needs: ${PASSWORD_REQUIREMENTS[first].toLowerCase()}` });
});

const currentPassword = z.string({ error: 'Enter your password' }).min(1, 'Enter your password');

/** Sign-up form: optional display name, email, new password. */
export const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .max(80, 'Use 80 characters or fewer')
    .optional()
    .transform((name) => name || undefined),
  email,
  password: newPassword,
});

/** Sign-in form. The password is only checked for presence; Supabase checks the rest. */
export const signInSchema = z.object({ email, password: currentPassword });

/** Forms that only ask for an email address (password reset, resending the confirmation). */
export const emailOnlySchema = z.object({ email });

/** Choosing a new password after following a reset link. */
export const newPasswordSchema = z.object({ password: newPassword });

/** Changing the password while signed in: the current one proves it's the owner. */
export const changePasswordSchema = z
  .object({ currentPassword, newPassword })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Choose a different password from your current one',
  });

/** Changing the sign-in email while signed in. */
export const changeEmailSchema = z.object({ email });

/** Field name → the first problem with that field. */
export type FieldErrors = Partial<Record<string, string>>;

/** Validates untrusted form input against a schema, returning clean values or one message per field. */
export function validate<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}
