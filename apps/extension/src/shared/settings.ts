import type { ActionKind, PacingRule, PresetName, Settings } from './types';

/**
 * Pacing presets per action. Defaults are deliberately conservative. X does not publish limits for deletes
 * or unlikes on the web; the public API allows 50 deletes / 15 min, and likes have historically been capped
 * around 1,000 / day. See docs/RESEARCH.md.
 */
export const PRESETS: Record<Exclude<PresetName, 'custom'>, Record<ActionKind, PacingRule>> = {
  careful: {
    delete: {
      minDelay: 6,
      maxDelay: 12,
      batchSize: 30,
      batchPauseMin: 180,
      batchPauseMax: 360,
      hourlyCap: 150,
      dailyCap: 1000,
    },
    unretweet: {
      minDelay: 6,
      maxDelay: 12,
      batchSize: 30,
      batchPauseMin: 180,
      batchPauseMax: 360,
      hourlyCap: 150,
      dailyCap: 1000,
    },
    unlike: {
      minDelay: 5,
      maxDelay: 10,
      batchSize: 40,
      batchPauseMin: 180,
      batchPauseMax: 360,
      hourlyCap: 180,
      dailyCap: 1000,
    },
    relike: {
      minDelay: 15,
      maxDelay: 30,
      batchSize: 20,
      batchPauseMin: 300,
      batchPauseMax: 600,
      hourlyCap: 40,
      dailyCap: 200,
    },
    read: {
      minDelay: 2,
      maxDelay: 4,
      batchSize: 60,
      batchPauseMin: 60,
      batchPauseMax: 120,
      hourlyCap: 400,
      dailyCap: 4000,
    },
  },
  balanced: {
    delete: {
      minDelay: 3,
      maxDelay: 6,
      batchSize: 60,
      batchPauseMin: 120,
      batchPauseMax: 240,
      hourlyCap: 400,
      dailyCap: 3000,
    },
    unretweet: {
      minDelay: 3,
      maxDelay: 6,
      batchSize: 60,
      batchPauseMin: 120,
      batchPauseMax: 240,
      hourlyCap: 400,
      dailyCap: 3000,
    },
    unlike: {
      minDelay: 3,
      maxDelay: 6,
      batchSize: 60,
      batchPauseMin: 120,
      batchPauseMax: 240,
      hourlyCap: 400,
      dailyCap: 2500,
    },
    relike: {
      minDelay: 10,
      maxDelay: 20,
      batchSize: 30,
      batchPauseMin: 300,
      batchPauseMax: 600,
      hourlyCap: 60,
      dailyCap: 400,
    },
    read: {
      minDelay: 1.5,
      maxDelay: 3,
      batchSize: 100,
      batchPauseMin: 45,
      batchPauseMax: 90,
      hourlyCap: 800,
      dailyCap: 8000,
    },
  },
};

/** Settings before the person changes anything: Careful pacing, no active hours, notifications on. */
export const DEFAULT_SETTINGS: Settings = {
  preset: 'careful',
  pacing: PRESETS.careful,
  activeHours: { enabled: false, start: 8, end: 23 },
  maxConsecutiveFailures: 5,
  notifications: true,
};

/** Dashboard labels for each action kind. */
export const ACTION_LABELS: Record<ActionKind, string> = {
  delete: 'Delete posts & replies',
  unretweet: 'Undo reposts',
  unlike: 'Unlike',
  relike: 'Ghost-like cleanup (like → unlike)',
  read: 'Page loads & scrolls',
};
