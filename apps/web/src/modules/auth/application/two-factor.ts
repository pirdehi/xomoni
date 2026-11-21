// Two-step verification use cases (#173, ADR-0036): the code after sign-in, and adding, listing and removing
// authenticator apps on the account page. They run in the person's browser (ADR-0011), so Supabase's per-IP limits
// apply to the person; Supabase's own rules (aal2 to add a second app or remove one) stand behind each of them.
import { authFailure, invalidInput, type AuthFailure, type AuthResult } from '../domain/auth-error';
import { validate } from '../domain/credentials';
import { safeNextPath } from '../domain/routes';
import {
  assuranceOf,
  confirmEnrollmentSchema,
  defaultFactorName,
  enrollSchema,
  secondFactorCodeSchema,
  type SecondFactor,
  type TotpEnrollment,
} from '../domain/two-factor';
import { verifyWithAnyFactor, wrongCode, type AuthDeps, type FormInput, type Navigate } from './use-cases';

/** What the two-step use cases need. */
export type TwoFactorDeps = Pick<AuthDeps, 'auth' | 'twoFactor'>;

/**
 * Verifies a code from one of the account's apps after a sign-in, raising the session to `aal2`, and returns where to
 * go next (same-site only). Each verified app is tried, so the page needn't ask which one the code came from.
 */
export async function verifySecondFactor(deps: TwoFactorDeps, input: FormInput): Promise<Navigate | AuthFailure> {
  const form = validate(secondFactorCodeSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const factors = await deps.twoFactor.factors();
  if (!factors) return authFailure('not_signed_in');
  const next = safeNextPath(typeof input.next === 'string' ? input.next : null);
  // Nothing to verify: the app was removed elsewhere, so the session is already enough.
  if (factors.verified.length === 0) return { ok: true, next };
  const result = await verifyWithAnyFactor(
    deps.twoFactor,
    factors.verified.map((f) => f.id),
    form.value.code,
  );
  if (!result.ok) return result.code === 'invalid_code' ? wrongCode(result) : result;
  return { ok: true, next };
}

/** The account's authenticator apps, oldest first, or a failure when signed out. */
export async function listSecondFactors(
  deps: TwoFactorDeps,
): Promise<{ ok: true; factors: SecondFactor[] } | AuthFailure> {
  const factors = await deps.twoFactor.factors();
  return factors ? { ok: true, factors: factors.verified } : authFailure('not_signed_in');
}

/**
 * Starts adding an app: returns its QR code and secret, shown once. An app someone started adding before and never
 * confirmed (an abandoned enrollment) is removed first, so it can't hold the name or count toward the limit. A second
 * app needs an `aal2` session; the account page is only reachable at `aal2` once there is a first.
 */
export async function startEnrollment(
  deps: TwoFactorDeps,
  input: FormInput,
): Promise<{ ok: true; enrollment: TotpEnrollment } | AuthFailure> {
  const form = validate(enrollSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const factors = await deps.twoFactor.factors();
  if (!factors) return authFailure('not_signed_in');
  if (factors.verified.length > 0 && !(await atAal2(deps))) return authFailure('second_factor_required');
  for (const id of factors.unverified) {
    const removed = await deps.twoFactor.unenroll(id);
    if (!removed.ok && removed.code !== 'factor_not_found') return removed;
  }
  const name = form.value.name ?? defaultFactorName(factors.verified);
  if (factors.verified.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    return { ...authFailure('factor_name_taken'), fieldErrors: { name: 'You already have an app with that name' } };
  }
  return deps.twoFactor.enroll(name);
}

/** Confirms the app being added with its first code. From then on, signing in asks for a code. */
export async function confirmEnrollment(deps: TwoFactorDeps, input: FormInput): Promise<AuthResult> {
  const form = validate(confirmEnrollmentSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const result = await deps.twoFactor.verify(form.value.factorId, form.value.code);
  return result.ok || result.code !== 'invalid_code' ? result : wrongCode(result);
}

/**
 * Drops an app the person stopped adding. Not confirmed, it never signed anyone in; Supabase also clears such apps
 * after a few minutes, and the next enrollment does (`startEnrollment`).
 */
export async function cancelEnrollment(deps: TwoFactorDeps, factorId: string): Promise<AuthResult> {
  const result = await deps.twoFactor.unenroll(factorId);
  return result.ok || result.code === 'factor_not_found' ? { ok: true } : result;
}

/**
 * Removes one of the account's apps. Only from a session that verified a code (`aal2`): this page refuses below it,
 * and so does Supabase, so a stolen password or session alone can't turn two-step verification off.
 */
export async function removeSecondFactor(deps: TwoFactorDeps, factorId: string): Promise<AuthResult> {
  if (!factorId) return authFailure('factor_not_found');
  const claims = await deps.auth.currentClaims();
  if (!claims) return authFailure('not_signed_in');
  if (assuranceOf(claims.aal) !== 'aal2') return authFailure('second_factor_required');
  return deps.twoFactor.unenroll(factorId);
}

async function atAal2({ auth }: TwoFactorDeps): Promise<boolean> {
  const claims = await auth.currentClaims();
  return assuranceOf(claims?.aal) === 'aal2';
}
