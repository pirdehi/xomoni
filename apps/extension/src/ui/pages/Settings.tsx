import {
  Caption1,
  Input,
  Link,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { ArrowDownload20Regular, Delete20Regular, ShieldCheckmark16Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, getSettings, kvSet } from '../../shared/db';
import { FINISHED_ID, notify } from '../../shared/notify';
import { ACTION_LABELS, PRESETS, normalizeSettings } from '../../shared/settings';
import { DAY } from '../../shared/time';
import type { ActionKind, PacingRule, PresetName, Settings } from '../../shared/types';
import { X_PUBLISHED_LIMITS, capCeilings, share } from '../../shared/x-limits';
import type { PageProps } from '../navigation';
import { Button, Callout, Card, Field, Modal, PageHeader, Segmented, Toggle } from '../components/ui';
import { downloadFile, errorMessage, toDateInput } from '../format';
import { toast, useRunner } from '../hooks';
import { type ThemeChoice, getStoredTheme, setTheme } from '../theme';
import { CloudCard } from '../components/CloudCard';

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

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingVerticalL,
    '@media (min-width: 1024px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  scroll: { overflowX: 'auto' },
  // Fluent's tables share the width out evenly; these size their columns to their content.
  table: { tableLayout: 'auto', fontVariantNumeric: 'tabular-nums' },
  headCell: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
  actionCell: {
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  numberField: { width: '5.5rem' },
  number: { fontVariantNumeric: 'tabular-nums' },
  unit: { fontSize: tokens.fontSizeBase100 },
  note: { margin: `${tokens.spacingVerticalM} 0 0`, color: tokens.colorNeutralForeground3 },
  limits: {
    marginTop: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  summary: {
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    borderRadius: tokens.borderRadiusMedium,
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  limitsTable: { marginTop: tokens.spacingVerticalS, fontSize: tokens.fontSizeBase200 },
  muted: { color: tokens.colorNeutralForeground3 },
  secondary: { color: tokens.colorNeutralForeground2 },
  strong: { fontWeight: tokens.fontWeightSemibold },
  limitsNote: { margin: `${tokens.spacingVerticalS} 0 0`, color: tokens.colorNeutralForeground3 },
  // Lines up with the text of the active-hours switch above it, as the kit's Toggle does for its description.
  hours: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalM,
    paddingLeft: '48px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
  noShrink: { flexShrink: 0 },
  failures: { width: '6rem' },
  goodIcon: { color: tokens.colorStatusSuccessForeground1 },
  rules: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    listStyleType: 'disc',
    '& > li + li': { marginTop: tokens.spacingVerticalXXS },
  },
  data: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalXL,
    paddingTop: tokens.spacingVerticalL,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  dataNote: { margin: 0, color: tokens.colorNeutralForeground2 },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
});

// Every save goes through the safety rules: custom values are clamped to one fifth of X's limits.
/** Saves settings brought back inside the safety rules; a failed save shows a toast. */
const save = (s: Settings) => {
  kvSet('settings', normalizeSettings(s)).catch((err: unknown) => toast(errorMessage(err), 'critical'));
};

/**
 * Pacing presets and per-action rules, active hours, notifications, the failure limit, theme, and
 * export or wipe of local data, drawn with Fluent UI (ADR-0019). Each change is saved to the `kv` table at once; a
 * running job keeps the settings it read when it started. Each pacing field is named by its action and column
 * (such as "Unlike, Per hour") for screen readers.
 */
export function SettingsPage(_props: PageProps) {
  const styles = useStyles();
  const settings = useLiveQuery(getSettings, []);
  const run = useRunner();
  const [theme, setThemeState] = useState<ThemeChoice>(getStoredTheme);
  const [wiping, setWiping] = useState(false);
  if (!settings) return null;

  const setPreset = (preset: PresetName) =>
    save({ ...settings, preset, pacing: preset === 'custom' ? settings.pacing : PRESETS.careful });
  const setRule = (action: ActionKind, key: keyof PacingRule, value: number) =>
    save({
      ...settings,
      preset: 'custom',
      pacing: { ...settings.pacing, [action]: { ...settings.pacing[action], [key]: value } },
    });

  const exportAll = async () => {
    const [accounts, items, jobs, logs] = await Promise.all([
      db.accounts.toArray(),
      db.items.toArray(),
      db.jobs.toArray(),
      db.logs.toArray(),
    ]);
    downloadFile(
      `xomoni-export-${toDateInput(Date.now())}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), accounts, items, jobs, logs }),
    );
  };

  const wipe = async () => {
    await Promise.all([
      db.items.clear(),
      db.jobs.clear(),
      db.logs.clear(),
      db.limits.clear(),
      db.accounts.clear(),
      db.kv.clear(),
    ]);
    setWiping(false);
    toast('All local Xomoni data was deleted', 'good');
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Pacing, safety and your local data. A running job keeps its settings until it is paused and resumed."
      />
      <div className={styles.stack}>
        <Card
          title="Pacing"
          subtitle="Xomoni uses at most one fifth of every limit X publishes, and of the live limits X reports. Custom values can be slower, never faster."
          actions={
            <Segmented
              value={settings.preset}
              onChange={setPreset}
              options={[
                { value: 'careful', label: 'Careful (⅕ of X)' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          }
        >
          <div className={styles.scroll}>
            <Table size="small" className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={styles.headCell}>Action</TableHeaderCell>
                  {COLUMNS.map((c) => (
                    <TableHeaderCell key={c.key} className={styles.headCell}>
                      {c.label}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ACTIONS.map((action) => (
                  <TableRow key={action}>
                    <TableCell className={styles.actionCell}>{ACTION_LABELS[action]}</TableCell>
                    {COLUMNS.map((c) => (
                      <TableCell key={c.key}>
                        <Input
                          size="small"
                          type="number"
                          className={styles.numberField}
                          input={{ className: styles.number }}
                          aria-label={`${ACTION_LABELS[action]}, ${c.label}${c.unit ? ' (seconds)' : ''}`}
                          min={c.unit ? 0 : 1}
                          max={c.key === 'hourlyCap' || c.key === 'dailyCap' ? capCeilings(action)[c.key] : undefined}
                          step={c.unit ? 0.5 : 1}
                          value={String(settings.pacing[action][c.key])}
                          contentAfter={c.unit ? <span className={styles.unit}>{c.unit}</span> : undefined}
                          onChange={(_, data) =>
                            setRule(action, c.key, Math.max(c.unit ? 0 : 1, Number(data.value) || 0))
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Caption1 as="p" block className={styles.note}>
            Delays vary around the middle of min–max, with an occasional longer pause. After each batch Xomoni takes a
            longer break, and after every 25–50 minutes of work it rests 10–30 minutes. Caps use rolling 1-hour and
            24-hour windows and can't be set above one fifth of X's limits.
          </Caption1>
          <XLimitsTable />
        </Card>

        <div className={styles.columns}>
          <Card title="Schedule & safety">
            <div className={styles.stack}>
              <Toggle
                checked={settings.activeHours.enabled}
                onChange={(enabled) => save({ ...settings, activeHours: { ...settings.activeHours, enabled } })}
                label="Only work during active hours"
                description="Pauses outside these hours, so work is spread over the day and never runs all night."
              />
              {settings.activeHours.enabled && (
                <div className={styles.hours}>
                  {(['start', 'end'] as const).map((k) => (
                    <Field key={k} label={k === 'start' ? 'From' : 'Until'}>
                      <Select
                        value={String(settings.activeHours[k])}
                        onChange={(_, data) =>
                          save({ ...settings, activeHours: { ...settings.activeHours, [k]: Number(data.value) } })
                        }
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}:00
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              )}
              <div className={styles.toggleRow}>
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
                    className={styles.noShrink}
                    onClick={() =>
                      void notify(
                        FINISHED_ID,
                        'Xomoni notifications work',
                        'You’ll see alerts like this when X needs you.',
                      )
                    }
                  >
                    Test
                  </Button>
                )}
              </div>
              <Field label="Pause after this many failures in a row">
                <Input
                  type="number"
                  className={styles.failures}
                  input={{ className: styles.number }}
                  min={1}
                  max={3}
                  value={String(settings.maxConsecutiveFailures)}
                  onChange={(_, data) =>
                    save({ ...settings, maxConsecutiveFailures: Math.max(1, Number(data.value) || 1) })
                  }
                />
              </Field>
              <Callout tone="good" icon={<ShieldCheckmark16Regular className={styles.goodIcon} />} title="Always on">
                <ul className={styles.rules}>
                  <li>Waits out X rate limits (HTTP 429 / code 88) and daily limits</li>
                  <li>Stops on “looks automated” (code 226)</li>
                  <li>Waits for you on logins, 2FA and X’s checks, then continues by itself</li>
                  <li>Never solves captchas, never touches your password or cookies</li>
                  <li>Counts an action only when X confirms it</li>
                </ul>
              </Callout>
            </div>
          </Card>

          <CloudCard />

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
            <div className={styles.data}>
              <Caption1 as="p" block className={styles.dataNote}>
                Your inventory, jobs and log live only in this browser profile.
              </Caption1>
              <div className={styles.buttons}>
                <Button icon={<ArrowDownload20Regular />} onClick={() => void exportAll()}>
                  Export everything
                </Button>
                <Button
                  variant="ghost"
                  icon={<Delete20Regular />}
                  onClick={() => setWiping(true)}
                  disabled={run.status !== 'idle'}
                >
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

/** X's published limits next to the share Xomoni allows itself, with links to where X publishes them. */
function XLimitsTable() {
  const styles = useStyles();
  return (
    <details className={styles.limits}>
      <summary className={styles.summary}>X's published limits and Xomoni's share</summary>
      <div className={styles.scroll}>
        <Table size="small" className={mergeClasses(styles.table, styles.limitsTable)}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={styles.headCell}>Limit</TableHeaderCell>
              <TableHeaderCell className={styles.headCell}>X allows</TableHeaderCell>
              <TableHeaderCell className={styles.headCell}>Xomoni uses at most</TableHeaderCell>
              <TableHeaderCell className={styles.headCell}>Source</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(X_PUBLISHED_LIMITS).map(([id, l]) => {
              const per = l.windowMs >= DAY ? 'day' : '15 min';
              return (
                <TableRow key={id}>
                  <TableCell>{l.label}</TableCell>
                  <TableCell className={styles.secondary}>
                    {l.limit} per {per}
                  </TableCell>
                  <TableCell className={styles.strong}>
                    {'neverUsed' in l ? 'none: Xomoni never posts' : `${share(l.limit)} per ${per}`}
                  </TableCell>
                  <TableCell>
                    <Link href={l.source} target="_blank" rel="noreferrer">
                      {new URL(l.source).hostname}
                    </Link>{' '}
                    <span className={styles.muted}>({l.checked})</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Caption1 as="p" block className={styles.limitsNote}>
        Posting limits are listed for completeness. While a job runs, Xomoni also stops at one fifth of the live limit X
        reports for each request and waits for X's window to reset.
      </Caption1>
    </details>
  );
}
