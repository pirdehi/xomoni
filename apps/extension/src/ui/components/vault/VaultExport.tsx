import { Body1, Caption1, Checkbox, Input, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowDownload16Regular, ErrorCircle16Regular, Warning16Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import {
  BYTES_PER_ROW,
  DEFAULT_PARTS,
  EXPORT_PARTS,
  type ExportRange,
  exportRowCounts,
  vaultExport,
} from '../../../shared/vault/export';
import type { Account } from '../../../shared/types';
import { downloadBlob, errorMessage, toDateInput } from '../../format';
import { toast } from '../../hooks';
import { Button, Card, Field, FieldGroup, Segmented } from '../ui';

const useStyles = makeStyles({
  form: { display: 'grid', gap: tokens.spacingVerticalM },
  parts: { display: 'grid', gap: tokens.spacingVerticalXS },
  others: { color: tokens.colorStatusWarningForeground1, marginLeft: tokens.spacingHorizontalXXL },
  dates: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
  muted: { color: tokens.colorNeutralForeground3 },
  problem: { color: tokens.colorStatusDangerForeground1, display: 'flex', gap: tokens.spacingHorizontalXS },
  row: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM, alignItems: 'center' },
});

/** The file's name: `xomoni-vault-<handle>-<yyyy-mm-dd>.zip`, today in the person's time zone. */
export function vaultExportName(handle: string, now = Date.now()): string {
  return `xomoni-vault-${handle || 'account'}-${toDateInput(now)}.zip`;
}

/** A size in words: `120 KB`, `3.4 MB`. */
const sizeWords = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en')} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The day a date input names, as the start (00:00) or the end (23:59:59.999) of that day in the person's time zone. */
function dayBound(value: string, end: boolean): number | null {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

/** The two ways to choose the dates. */
type Span = 'all' | 'dates';

const SPANS: { value: Span; label: string }[] = [
  { value: 'all', label: 'All of it' },
  { value: 'dates', label: 'Choose dates' },
];

/**
 * *Export my vault* on the Vault page (#426, ADR-0044): one ZIP the person keeps, with each chosen part as CSV and JSON,
 * a README, `schema.json` and a page for any browser. Every part of the person's own is ticked; the replies others wrote
 * to them are not, beside a line that says whose words they hold. Formats, dates, an estimate of the size, progress
 * and *Cancel*, which downloads nothing. The file is saved in Downloads and never leaves the computer. Always free.
 */
export function VaultExport({ account, appVersion }: { account: Account; appVersion: () => string }) {
  const styles = useStyles();
  const [parts, setParts] = useState<ReadonlySet<string>>(new Set(DEFAULT_PARTS));
  const [csv, setCsv] = useState(true);
  const [json, setJson] = useState(true);
  const [span, setSpan] = useState<Span>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(() => toDateInput(Date.now()));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const counts = useLiveQuery(() => exportRowCounts(account.id), [account.id]);

  const range: ExportRange | null =
    span === 'all'
      ? { from: null, to: null }
      : (() => {
          const start = from ? dayBound(from, false) : null;
          const end = to ? dayBound(to, true) : null;
          return start !== null && end !== null && start > end ? null : { from: start, to: end };
        })();
  const rows = [...parts].reduce((sum, id) => sum + (counts?.[id] ?? 0), 0);
  const estimate = rows * BYTES_PER_ROW * ((csv ? 1 : 0) + (json ? 2 : 0)) + 20_000;
  const ready = !!parts.size && (csv || json) && range !== null && busy === null;

  const toggle = (id: string, on: boolean) =>
    setParts((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = async () => {
    if (!range) return;
    const controller = new AbortController();
    stop.current = controller;
    setError(null);
    setBusy('Starting…');
    try {
      const { zip } = await vaultExport(
        account,
        { parts: [...parts], csv, json, range },
        { appVersion: appVersion(), signal: controller.signal, onProgress: setBusy },
      );
      if (controller.signal.aborted) return;
      const name = vaultExportName(account.handle);
      downloadBlob(name, zip);
      toast(`Saved ${name}. It stays on your computer: Xomoni never sends it anywhere.`, 'good');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError')
        toast('Export cancelled. Nothing was saved.', 'neutral');
      else setError(`The export wasn’t made: ${errorMessage(err)}`);
    } finally {
      stop.current = null;
      setBusy(null);
    }
  };

  return (
    <Card
      title="Export my vault"
      subtitle="One ZIP you keep: CSV for spreadsheets, JSON for other tools, and a page any browser opens. You don’t need Xomoni to read it, and it never leaves this computer."
    >
      <div className={styles.form}>
        <FieldGroup label="What to include">
          <div className={styles.parts}>
            {EXPORT_PARTS.map((part) => (
              <div key={part.id}>
                <Checkbox
                  label={`${part.label} (${(counts?.[part.id] ?? 0).toLocaleString('en')})`}
                  checked={parts.has(part.id)}
                  onChange={(_, data) => toggle(part.id, data.checked === true)}
                />
                {part.others && (
                  <Caption1 as="p" className={styles.others}>
                    <Warning16Regular aria-hidden /> Contains other people’s words. Leave it out unless you need it.
                  </Caption1>
                )}
              </div>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup label="Formats">
          <div className={styles.row}>
            <Checkbox
              label="CSV, for spreadsheets"
              checked={csv}
              onChange={(_, data) => setCsv(data.checked === true)}
            />
            <Checkbox
              label="JSON, for other tools"
              checked={json}
              onChange={(_, data) => setJson(data.checked === true)}
            />
          </div>
        </FieldGroup>
        <FieldGroup label="Dates">
          <Segmented value={span} onChange={setSpan} options={SPANS} />
        </FieldGroup>
        {span === 'dates' && (
          <div className={styles.dates}>
            <Field label="From">
              <Input type="date" value={from} max={to || undefined} onChange={(_, data) => setFrom(data.value)} />
            </Field>
            <Field label="To (inclusive)">
              <Input type="date" value={to} min={from || undefined} onChange={(_, data) => setTo(data.value)} />
            </Field>
          </div>
        )}
        {range === null && (
          <Caption1 as="p" className={styles.problem} role="alert">
            <ErrorCircle16Regular aria-hidden /> Pick a start date on or before the end date.
          </Caption1>
        )}
        {!parts.size && (
          <Caption1 as="p" className={styles.problem}>
            <ErrorCircle16Regular aria-hidden /> Tick at least one part to export.
          </Caption1>
        )}
        {!csv && !json && (
          <Caption1 as="p" className={styles.problem}>
            <ErrorCircle16Regular aria-hidden /> Tick CSV, JSON or both.
          </Caption1>
        )}
        <Caption1 as="p" className={styles.muted}>
          About {sizeWords(estimate)}, with {rows.toLocaleString('en')} rows{span === 'dates' ? ' at most' : ''}.
        </Caption1>
        <div className={styles.row}>
          <Button variant="primary" icon={<ArrowDownload16Regular />} disabled={!ready} onClick={() => void run()}>
            Export my vault
          </Button>
          {busy !== null && (
            <>
              <Spinner size="tiny" label={busy} />
              <Button onClick={() => stop.current?.abort()}>Cancel</Button>
            </>
          )}
        </div>
        {error && (
          <Body1 as="p" role="alert" className={styles.problem}>
            {error}
          </Body1>
        )}
      </div>
    </Card>
  );
}
