'use client';
// Settings on xomoni.com (#234, ADR-0029): Xomoni's own settings, read from and changed in Xomoni in this browser.
// Xomoni applies its own rules to every change and answers the settings as stored, which this page then shows: it
// never shows what it sent as if it were saved. Custom pacing, the theme and deleting local data stay in Xomoni.
// The choice of daily numbers lives in the cloud (ADR-0026) and is shown here on any device. On Fluent UI (ADR-0019).
import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Switch,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { Add16Regular, ArrowClockwise16Regular, Dismiss16Regular } from '@fluentui/react-icons';
import {
  MAX_READ_QUERY,
  MAX_WATCH_SEARCHES,
  PACE_ACTIONS,
  type PaceAction,
  type SettingsChange,
  type XomoniSettings,
} from '@xomoni/bridge';
import { type ReactNode, useState } from 'react';
import { OpenInXomoni, type XomoniControls, useXomoniRead } from '@/modules/extension/ui/xomoni-actions';
import { formatCount } from './charts';
import { NoAnswer, NotHere, Notice } from './xomoni-places';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  title: { ...typographyStyles.subtitle2, margin: 0 },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  table: { borderCollapse: 'collapse', width: '100%', maxWidth: '560px' },
  cell: {
    ...typographyStyles.body1,
    textAlign: 'left',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  number: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  caption: { textAlign: 'left', paddingBottom: tokens.spacingVerticalXS },
  rowHead: { fontWeight: tokens.fontWeightRegular },
  hours: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalL },
  hour: { minWidth: '120px' },
  narrow: { maxWidth: '200px' },
  searches: { display: 'grid', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0, listStyleType: 'none' },
  search: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, maxWidth: '480px' },
  searchInput: { flexGrow: 1 },
});

/** Each paced action, in Xomoni's own words. */
const ACTION_LABEL: Record<PaceAction, string> = {
  delete: 'Delete posts & replies',
  unretweet: 'Undo reposts',
  unlike: 'Unlike',
  relike: 'Ghost-like cleanup (like → unlike)',
  read: 'Page loads & scrolls',
};

/** The Watch tabs that always stay, as in Xomoni: clearing one leaves it empty. */
const KEPT_SEARCHES = 2;

const hourText = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Why Xomoni didn't take a change, in plain words. */
function refusalText(reason: string): string {
  switch (reason) {
    case 'signed_out':
    case 'not_connected':
    case 'other_account':
      return 'Xomoni in this browser isn’t signed in to this account, so nothing changed.';
    case 'no_answer':
      return 'Xomoni didn’t answer, so nothing changed. Open it on this computer and try again.';
    case 'invalid':
      return 'Your Xomoni is older than this page and can’t change its settings from here yet, so nothing changed. Install the newest version, then try again.';
    default:
      return 'Xomoni didn’t take that change, so nothing changed.';
  }
}

/**
 * Settings (#234): Xomoni's pace, active hours, safety, notifications and the active account's Watch searches, read
 * from Xomoni in this browser and changed there within its rules (ADR-0029), and the choice of daily numbers
 * (`numbers`), which works anywhere.
 */
export function SettingsPlace({ xomoni, numbers }: { xomoni: XomoniControls; numbers: ReactNode }) {
  const s = useStyles();
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'settings' });
  // What Xomoni last answered to a change here: newer than the read, until the page reads again.
  const [saved, setSaved] = useState<{ settings: XomoniSettings; from: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (xomoni.presence.kind !== 'here') {
    return (
      <div className={s.root}>
        <NotHere
          xomoni={xomoni}
          page="settings"
          what="Xomoni’s settings"
          says="Xomoni’s settings live in Xomoni on your computer, and change only there. Open this page in the browser where Xomoni runs, signed in to this account, to see and change them here."
        />
        {numbers}
      </div>
    );
  }

  const read = answer?.ok && answer.what === 'settings' ? answer.settings : null;
  const settings = saved && saved.from === answer ? saved.settings : read;

  async function change(next: SettingsChange) {
    setBusy(true);
    setMessage(null);
    const result = await xomoni.changeSettings(next);
    setBusy(false);
    if (result?.ok) {
      setSaved({ settings: result.settings, from: answer });
      setMessage({
        ok: true,
        text: 'Saved in Xomoni. A running job keeps its settings until it is paused and resumed.',
      });
    } else {
      setMessage({ ok: false, text: refusalText(result ? result.reason : 'no_answer') });
    }
  }

  return (
    <div className={s.root}>
      <Notice>Read from Xomoni in this browser and changed there, within its safety rules.</Notice>
      {loading && !settings && <Spinner size="small" label="Reading Xomoni…" />}
      {answer && !answer.ok && <NoAnswer reason={answer.reason} doing="show its settings" />}
      {message && (
        <MessageBar intent={message.ok ? 'success' : 'warning'}>
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}
      {settings && (
        <>
          <Pace settings={settings} busy={busy} onChange={change} xomoni={xomoni} />
          <Hours settings={settings} busy={busy} onChange={change} />
          <Safety settings={settings} busy={busy} onChange={change} />
          <Searches key={settings.watch.join('\n')} settings={settings} busy={busy} onChange={change} />
        </>
      )}
      {numbers}
      <div>
        <Button appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={reload}>
          Read again
        </Button>
      </div>
    </div>
  );
}

interface CardProps {
  settings: XomoniSettings;
  busy: boolean;
  onChange: (change: SettingsChange) => Promise<void>;
}

/** The pace: Careful at the one-fifth ceilings, or custom (slower), with each action's caps. */
function Pace({ settings, busy, onChange, xomoni }: CardProps & { xomoni: XomoniControls }) {
  const s = useStyles();
  const careful = settings.preset === 'careful';
  return (
    <section className={s.card} aria-labelledby="pace-title">
      <div className={s.row}>
        <h2 id="pace-title" className={s.title}>
          Pace
        </h2>
        <Badge appearance="tint" color={careful ? 'success' : 'informative'}>
          {careful ? 'Careful' : 'Custom'}
        </Badge>
      </div>
      <p className={s.text}>
        {careful
          ? 'Xomoni works at a fifth of every limit X publishes, at most, with pauses between batches.'
          : 'Slower than Careful, as you set it in Xomoni. It can never be faster than Careful.'}
      </p>
      <table className={s.table}>
        <caption className={mergeClasses(s.meta, s.caption)}>The most Xomoni does</caption>
        <thead>
          <tr>
            <th scope="col" className={s.cell}>
              Action
            </th>
            <th scope="col" className={mergeClasses(s.cell, s.number)}>
              Per hour
            </th>
            <th scope="col" className={mergeClasses(s.cell, s.number)}>
              Per day
            </th>
          </tr>
        </thead>
        <tbody>
          {PACE_ACTIONS.map((action) => (
            <tr key={action}>
              <th scope="row" className={mergeClasses(s.cell, s.rowHead)}>
                {ACTION_LABEL[action]}
              </th>
              <td className={mergeClasses(s.cell, s.number)}>{formatCount(settings.pace[action].perHour)}</td>
              <td className={mergeClasses(s.cell, s.number)}>{formatCount(settings.pace[action].perDay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={s.row}>
        {!careful && (
          <Button disabled={busy} onClick={() => void onChange({ preset: 'careful' })}>
            Back to Careful
          </Button>
        )}
        <OpenInXomoni xomoni={xomoni} page="settings" />
      </div>
      <p className={s.meta}>Custom pacing is set in Xomoni, where its table lives.</p>
    </section>
  );
}

/** Active hours: on or off, and from when until when, on this computer's clock. */
function Hours({ settings, busy, onChange }: CardProps) {
  const s = useStyles();
  const hours = settings.activeHours;
  return (
    <section className={s.card} aria-labelledby="hours-title">
      <h2 id="hours-title" className={s.title}>
        Active hours
      </h2>
      <Switch
        label="Only work during active hours"
        checked={hours.enabled}
        disabled={busy}
        onChange={(_, data) => void onChange({ activeHours: { ...hours, enabled: data.checked } })}
      />
      <p className={s.meta}>
        Outside these hours Xomoni waits, so work is spread over the day and never runs all night. The same hour for
        both means all day.
      </p>
      {hours.enabled && (
        <div className={s.hours}>
          {(['start', 'end'] as const).map((k) => (
            <Field key={k} label={k === 'start' ? 'From' : 'Until'} className={s.hour}>
              <Select
                value={String(hours[k])}
                disabled={busy}
                onChange={(_, data) => void onChange({ activeHours: { ...hours, [k]: Number(data.value) } })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourText(h)}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      )}
    </section>
  );
}

/** Safety and notifications: failures in a row before a job pauses, desktop notifications, keep going while away. */
function Safety({ settings, busy, onChange }: CardProps) {
  const s = useStyles();
  return (
    <section className={s.card} aria-labelledby="safety-title">
      <h2 id="safety-title" className={s.title}>
        Safety and notifications
      </h2>
      <Field label="Pause a job after this many unknown failures in a row">
        <Select
          className={s.narrow}
          value={String(settings.maxFailures)}
          disabled={busy}
          onChange={(_, data) => void onChange({ maxFailures: Number(data.value) })}
        >
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <Switch
        label="Desktop notifications"
        checked={settings.notifications}
        disabled={busy}
        onChange={(_, data) => void onChange({ notifications: data.checked })}
      />
      <p className={s.meta}>When X needs you, and when a job ends.</p>
      <Switch
        label="Keep going while away"
        checked={settings.whileAway}
        disabled={busy}
        onChange={(_, data) => void onChange({ whileAway: data.checked })}
      />
      <p className={s.meta}>
        The display stays on while a job runs, and after two minutes away a covered X window comes forward.
      </p>
    </section>
  );
}

/** The active account's Watch searches: edited here, saved together. */
function Searches({ settings, busy, onChange }: CardProps) {
  const s = useStyles();
  const [draft, setDraft] = useState(settings.watch);
  const changed = draft.join('\n') !== settings.watch.join('\n');
  if (!settings.handle) {
    return (
      <section className={s.card} aria-labelledby="searches-title">
        <h2 id="searches-title" className={s.title}>
          Watch searches
        </h2>
        <p className={s.text}>Xomoni doesn’t know an X account yet: open X in Xomoni first.</p>
      </section>
    );
  }
  return (
    <section className={s.card} aria-labelledby="searches-title">
      <h2 id="searches-title" className={s.title}>
        Watch searches for @{settings.handle}
      </h2>
      <p className={s.meta}>
        Phrases or #hashtags. Xomoni searches them while Watch runs, within its read budget, and only reads.
      </p>
      <ul className={s.searches} aria-label="Watch searches">
        {draft.map((query, i) => (
          <li key={i} className={s.search}>
            <Input
              className={s.searchInput}
              aria-label={`Search ${i + 1}`}
              placeholder="A phrase or #hashtag"
              value={query}
              maxLength={MAX_READ_QUERY}
              disabled={busy}
              onChange={(_, data) => setDraft(draft.map((q, j) => (j === i ? data.value : q)))}
            />
            {i >= KEPT_SEARCHES && (
              <Button
                appearance="subtle"
                icon={<Dismiss16Regular />}
                aria-label={`Remove search ${i + 1}`}
                disabled={busy}
                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
              />
            )}
          </li>
        ))}
      </ul>
      <div className={s.row}>
        <Button
          appearance="primary"
          disabled={busy || !changed}
          onClick={() => void onChange({ watch: draft.map((q) => q.trim()) })}
        >
          Save searches
        </Button>
        {draft.length < MAX_WATCH_SEARCHES && (
          <Button appearance="subtle" icon={<Add16Regular />} disabled={busy} onClick={() => setDraft([...draft, ''])}>
            Add a search
          </Button>
        )}
      </div>
    </section>
  );
}
