import type { ActionKind, PacingRule, PresetName, Settings } from './types';
import { capCeilings, clampRule } from './x-limits';

const ceil = capCeilings;

/**
 * Pacing presets per action. Careful runs at the one-fifth ceiling of every limit X publishes (ADR-0012,
 * `x-limits.ts`): for deletes that is 10 per 15 minutes, so its delays average about 100 s, which keeps the
 * pace even instead of bursting into the window. Custom settings may be slower, never faster.
 */
export const PRESETS: Record<Exclude<PresetName, 'custom'>, Record<ActionKind, PacingRule>> = {
  careful: {
    delete: { minDelay: 80, maxDelay: 120, batchSize: 25, batchPauseMin: 300, batchPauseMax: 600, ...ceil('delete') },
    unretweet: {
      minDelay: 80,
      maxDelay: 120,
      batchSize: 25,
      batchPauseMin: 300,
      batchPauseMax: 600,
      ...ceil('unretweet'),
    },
    unlike: { minDelay: 80, maxDelay: 120, batchSize: 25, batchPauseMin: 300, batchPauseMax: 600, ...ceil('unlike') },
    relike: { minDelay: 90, maxDelay: 150, batchSize: 10, batchPauseMin: 600, batchPauseMax: 900, ...ceil('relike') },
    read: { minDelay: 3, maxDelay: 6, batchSize: 40, batchPauseMin: 60, batchPauseMax: 120, ...ceil('read') },
  },
};

/** Settings before the person changes anything: Careful pacing, no active hours, notifications on. */
export const DEFAULT_SETTINGS: Settings = {
  preset: 'careful',
  pacing: PRESETS.careful,
  activeHours: { enabled: false, start: 8, end: 23 },
  maxConsecutiveFailures: 2,
  notifications: true,
};

/**
 * Brings stored or edited settings back inside the safety rules: a preset that no longer exists (such as the
 * old Balanced) becomes Careful, every custom rule is clamped to the one-fifth ceilings with its minimums at
 * most its maximums, and the failure limit stays between 1 and 3.
 */
export function normalizeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  // Unknown failures in a row before the job pauses: at most 3, so a changed page or a quiet refusal by X
  // can't be retried again and again (PLAYBOOK C3).
  const failures = Number(merged.maxConsecutiveFailures);
  merged.maxConsecutiveFailures = Number.isFinite(failures) ? Math.min(3, Math.max(1, Math.round(failures))) : 2;
  if (merged.preset !== 'custom') return { ...merged, preset: 'careful', pacing: PRESETS.careful };
  const pacing = {} as Record<ActionKind, PacingRule>;
  for (const action of Object.keys(DEFAULT_SETTINGS.pacing) as ActionKind[]) {
    pacing[action] = clampRule(action, { ...DEFAULT_SETTINGS.pacing[action], ...stored?.pacing?.[action] });
  }
  return { ...merged, pacing };
}

/** Dashboard labels for each action kind. */
export const ACTION_LABELS: Record<ActionKind, string> = {
  delete: 'Delete posts & replies',
  unretweet: 'Undo reposts',
  unlike: 'Unlike',
  relike: 'Ghost-like cleanup (like → unlike)',
  read: 'Page loads & scrolls',
};
