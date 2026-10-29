import { useLiveQuery } from 'dexie-react-hooks';
import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { db, getSettings, kvSet } from '../../shared/db';
import { FINISHED_ID, notify } from '../../shared/notify';
import { ACTION_LABELS, PRESETS } from '../../shared/settings';
import type { ActionKind, PacingRule, PresetName, Settings } from '../../shared/types';
import type { PageProps } from '../App';
import { Button, Card, Field, Modal, PageHeader, Segmented, Toggle } from '../components/ui';
import { downloadFile, toDateInput } from '../format';
import { toast, useRunner } from '../hooks';
import { type ThemeChoice, getStoredTheme, setTheme } from '../theme';

const ACTIONS: ActionKind[] = ['delete', 'unretweet', 'unlike', 'relike', 'read'];
const COLUMNS: { key: keyof PacingRule; label: string; unit?: string }[] = [
  { key: 'minDelay', label: 'Min delay', unit: 's' },
  { key: 'maxDelay', label: 'Max delay', unit: 's' },
  { key: 'batchSize', label: 'Batch' },
  { key: 'batchPauseMin', label: 'Break min', unit: 's' },
  { key: 'batchPauseMax', label: 'Break max', unit: 's' },
  { key: 'hourlyCap', label: 'Per hour' },
  { key: 'dailyCap', label: 'Per day' },
];

const save = (s: Settings) => kvSet('settings', s);

export function SettingsPage(_props: PageProps) {
  const settings = useLiveQuery(getSettings, []);
  const run = useRunner();
  const [theme, setThemeState] = useState<ThemeChoice>(getStoredTheme);
  const [wiping, setWiping] = useState(false);
  if (!settings) return null;

  const setPreset = (preset: PresetName) => save({ ...settings, preset, pacing: preset === 'custom' ? settings.pacing : PRESETS[preset] });
  const setRule = (action: ActionKind, key: keyof PacingRule, value: number) =>
    save({ ...settings, preset: 'custom', pacing: { ...settings.pacing, [action]: { ...settings.pacing[action], [key]: value } } });

  const exportAll = async () => {
    const [accounts, items, jobs, logs] = await Promise.all([db.accounts.toArray(), db.items.toArray(), db.jobs.toArray(), db.logs.toArray()]);
    downloadFile(`xomoni-export-${toDateInput(Date.now())}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), accounts, items, jobs, logs }));
  };

  const wipe = async () => {
    await Promise.all([db.items.clear(), db.jobs.clear(), db.logs.clear(), db.limits.clear(), db.accounts.clear(), db.kv.clear()]);
    setWiping(false);
    toast('All local Xomoni data was deleted', 'good');
  };

  return (
    <>
      <PageHeader title="Settings" description="Pacing, safety and your local data. Changes apply to the next action." />
      <div className="space-y-4">
        <Card
          title="Pacing"
          subtitle="How fast Xomoni works. Careful is recommended — X does not publish limits for deleting or unliking."
          actions={
            <Segmented
              value={settings.preset}
              onChange={setPreset}
              options={[
                { value: 'careful', label: 'Careful' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Action</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="pb-2 pl-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACTIONS.map((action) => (
                  <tr key={action} className="border-t border-line">
                    <td className="py-2 pr-3 text-xs font-medium whitespace-nowrap text-ink">{ACTION_LABELS[action]}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="py-2 pl-2">
                        <div className="relative w-20">
                          <input
                            className="field tabular py-1 pr-5 text-xs"
                            type="number"
                            min={c.unit ? 0 : 1}
                            step={c.unit ? 0.5 : 1}
                            value={settings.pacing[action][c.key]}
                            onChange={(e) => setRule(action, c.key, Math.max(c.unit ? 0 : 1, Number(e.target.value) || 0))}
                          />
                          {c.unit && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted">{c.unit}</span>}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Delays are randomized between min and max. After each batch Xomoni takes a longer break. Caps use rolling 1-hour and 24-hour windows.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Schedule & safety">
            <div className="space-y-4">
              <Toggle
                checked={settings.activeHours.enabled}
                onChange={(enabled) => save({ ...settings, activeHours: { ...settings.activeHours, enabled } })}
                label="Only work during active hours"
                description="Pauses outside these hours, like a person would."
              />
              {settings.activeHours.enabled && (
                <div className="grid grid-cols-2 gap-3 pl-12">
                  {(['start', 'end'] as const).map((k) => (
                    <Field key={k} label={k === 'start' ? 'From' : 'Until'}>
                      <select
                        className="field"
                        value={settings.activeHours[k]}
                        onChange={(e) => save({ ...settings, activeHours: { ...settings.activeHours, [k]: Number(e.target.value) } })}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}:00
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <Toggle
                  checked={settings.notifications}
                  onChange={(notifications) => save({ ...settings, notifications })}
                  label="Desktop notifications"
                  description="When X needs you (login, 2FA, a check) and when a job ends."
                />
                {settings.notifications && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => void notify(FINISHED_ID, 'Xomoni notifications work', 'You’ll see alerts like this when X needs you.')}
                  >
                    Test
                  </Button>
                )}
              </div>
              <Field label="Pause after this many failures in a row">
                <input
                  className="field tabular w-24"
                  type="number"
                  min={1}
                  value={settings.maxConsecutiveFailures}
                  onChange={(e) => save({ ...settings, maxConsecutiveFailures: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
              <div className="rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
                <div className="mb-1.5 flex items-center gap-1.5 font-medium text-ink">
                  <ShieldCheck size={13} className="text-good" /> Always on
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>Waits out X rate limits (HTTP 429 / code 88) and daily limits</li>
                  <li>Stops on “looks automated” (code 226)</li>
                  <li>Waits for you on logins, 2FA and X’s checks, then continues by itself</li>
                  <li>Never solves captchas, never touches your password or cookies</li>
                  <li>Counts an action only when X confirms it</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card title="Appearance & data">
            <Field label="Theme">
              <Segmented
                value={theme}
                onChange={(t) => {
                  setTheme(t);
                  setThemeState(t);
                }}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </Field>
            <div className="mt-5 space-y-2 border-t border-line pt-4">
              <p className="text-xs text-ink-2">Your inventory, jobs and log live only in this browser profile.</p>
              <div className="flex flex-wrap gap-2">
                <Button icon={<Download size={14} />} onClick={() => void exportAll()}>
                  Export everything
                </Button>
                <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => setWiping(true)} disabled={run.status !== 'idle'}>
                  Delete local data
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={wiping}
        onClose={() => setWiping(false)}
        title="Delete all local data?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWiping(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void wipe()}>
              Delete local data
            </Button>
          </>
        }
      >
        This removes Xomoni’s inventory, jobs, activity log and settings from this browser. Nothing on X is changed.
      </Modal>
    </>
  );
}
