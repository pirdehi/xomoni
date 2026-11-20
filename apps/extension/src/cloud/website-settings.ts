// Xomoni's settings for xomoni.com in this browser (ADR-0029, #234): read them, and change the few the website may.
// Every change goes through the extension's own rules (`normalizeSettings`, the Watch rules), so nothing is set faster
// than Careful or above the one-fifth ceilings (ADR-0012), and every change is written to the activity log.
import {
  PACE_ACTIONS,
  type SettingsAnswer,
  type SettingsChange,
  type SettingsMessage,
  type XomoniSettings,
} from '@xomoni/bridge';
import { addLog, getSettings, kvSet, setWatchQueries, watchTabs } from '../shared/db';
import { PRESETS, normalizeSettings } from '../shared/settings';
import type { Settings } from '../shared/types';
import { accessRefusal, activeAccount } from './website-access';

/** The settings as xomoni.com shows them, with the active account's Watch searches. */
export async function readSettings(): Promise<XomoniSettings> {
  const settings = await getSettings();
  const account = await activeAccount();
  const tabs = account ? await watchTabs(account.id) : [];
  const pace = {} as XomoniSettings['pace'];
  for (const action of PACE_ACTIONS) {
    const rule = settings.pacing[action];
    pace[action] = { perHour: rule.hourlyCap, perDay: rule.dailyCap };
  }
  return {
    preset: settings.preset,
    pace,
    activeHours: { ...settings.activeHours },
    notifications: settings.notifications,
    whileAway: settings.whileAway,
    maxFailures: settings.maxConsecutiveFailures,
    handle: account?.handle ?? '',
    watch: tabs.map((t) => t.query),
  };
}

const hourText = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** What a change did, in the log's words: "active hours 09:00–22:00, notifications off". */
export function describeChange(change: SettingsChange): string {
  const parts: string[] = [];
  if (change.preset) parts.push('pacing back to Careful');
  if (change.activeHours) {
    const { enabled, start, end } = change.activeHours;
    parts.push(enabled ? `active hours ${hourText(start)}–${hourText(end)}` : 'active hours off');
  }
  if (change.notifications !== undefined) parts.push(`notifications ${change.notifications ? 'on' : 'off'}`);
  if (change.whileAway !== undefined) parts.push(`keep going while away ${change.whileAway ? 'on' : 'off'}`);
  if (change.maxFailures !== undefined) parts.push(`pause after ${change.maxFailures} failures in a row`);
  if (change.watch) {
    const searches = change.watch.filter((q) => q.trim());
    parts.push(searches.length ? `Watch searches: ${searches.join(', ')}` : 'Watch searches cleared');
  }
  return parts.join(', ');
}

/** `settings` with `change` applied, before Xomoni's own rules check it. */
function applied(settings: Settings, change: SettingsChange): Settings {
  const next: Settings = { ...settings };
  if (change.preset) Object.assign(next, { preset: 'careful', pacing: PRESETS.careful });
  if (change.activeHours) next.activeHours = { ...change.activeHours };
  if (change.notifications !== undefined) next.notifications = change.notifications;
  if (change.whileAway !== undefined) next.whileAway = change.whileAway;
  if (change.maxFailures !== undefined) next.maxConsecutiveFailures = change.maxFailures;
  return next;
}

/**
 * Answers `xomoni-settings` (ADR-0029): applies the change through Xomoni's own rules, logs it, and returns the
 * settings as stored. A running job keeps the settings it started with until it is paused and resumed.
 */
export async function answerSettings(message: SettingsMessage): Promise<SettingsAnswer> {
  const refused = await accessRefusal(message.deviceId);
  if (refused) return { ok: false, reason: refused };
  const { change } = message;
  const account = await activeAccount();
  if (change.watch && !account) return { ok: false, reason: 'refused' };
  if (Object.keys(change).some((key) => key !== 'watch'))
    await kvSet('settings', normalizeSettings(applied(await getSettings(), change)));
  if (change.watch && account) await setWatchQueries(account.id, change.watch);
  await addLog({
    accountId: account?.id ?? '',
    jobId: null,
    level: 'info',
    action: 'system',
    targetId: null,
    outcome: null,
    message: `Settings changed on xomoni.com: ${describeChange(change)}.`,
  });
  return { ok: true, settings: await readSettings() };
}
