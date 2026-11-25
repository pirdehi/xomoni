import { Body1, Caption1, Checkbox, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowUpload16Regular,
  CheckmarkCircle16Regular,
  DocumentArrowUp20Regular,
  ErrorCircle16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useRef, useState } from 'react';
import type { ImportPlan, PartResult, PlannedPart } from '../../../shared/vault/importer';
import type { Account } from '../../../shared/types';
import { errorMessage, fmtDate } from '../../format';
import { toast } from '../../hooks';
import { VAULT_ACCEPT, describeResult, partsToImport, planVaultImport, runVaultImport } from '../../vault-import';
import { Button, Card, Modal } from '../ui';

const useStyles = makeStyles({
  zone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  icon: { color: tokens.colorBrandForeground1 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: tokens.spacingVerticalM },
  part: { display: 'grid', gap: tokens.spacingVerticalXS },
  line: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'flex-start' },
  name: { overflowWrap: 'anywhere' },
  muted: { color: tokens.colorNeutralForeground3 },
  warn: { color: tokens.colorStatusWarningForeground1 },
  bad: { color: tokens.colorStatusDangerForeground1 },
  good: { color: tokens.colorStatusSuccessForeground1 },
  alert: { marginTop: tokens.spacingVerticalM, color: tokens.colorStatusDangerForeground1 },
});

const megabytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en')} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Where the import is: nothing yet, a plan to confirm, importing, or done. */
type Step =
  | { kind: 'idle' }
  | { kind: 'planning' }
  | { kind: 'plan'; plan: ImportPlan }
  | { kind: 'importing'; plan: ImportPlan; progress: string }
  | { kind: 'done'; results: PartResult[] };

/**
 * *Add files* on the Vault page (#425): one place to drop, or choose, X's archive (the ZIP), its analytics export (CSV)
 * and any other file of X's the vault reads. Before anything is written, *Import these files?* shows what was
 * recognized, for which account, and with what warning: a file already imported, a file whose owner the person must
 * confirm, and every refused file with why. *Import* reads the confirmed files with progress and a *Stop* between
 * batches; the result says what came in, with a link to the import ledger. Nothing is sent anywhere.
 */
export function VaultDrop({ account, ledgerId }: { account: Account; ledgerId: string }) {
  const styles = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const stop = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [confirmed, setConfirmed] = useState<ReadonlySet<PlannedPart>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const plan = async (list: FileList | readonly File[] | null) => {
    if (!list?.length) return;
    setError(null);
    setStep({ kind: 'planning' });
    setConfirmed(new Set());
    try {
      setStep({ kind: 'plan', plan: await planVaultImport([...list], account) });
    } catch (err) {
      setError(errorMessage(err));
      setStep({ kind: 'idle' });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const run = async (current: ImportPlan) => {
    const controller = new AbortController();
    stop.current = controller;
    setStep({ kind: 'importing', plan: current, progress: 'Starting…' });
    try {
      const results = await runVaultImport(current, confirmed, {
        signal: controller.signal,
        onProgress: (progress) => setStep({ kind: 'importing', plan: current, progress }),
      });
      setStep({ kind: 'done', results });
      toast(controller.signal.aborted ? 'Import stopped. What came in stays.' : 'Imported into your vault', 'good');
    } catch (err) {
      setError(`Not imported: ${errorMessage(err)}`);
      setStep({ kind: 'idle' });
    } finally {
      stop.current = null;
    }
  };

  const close = () => {
    stop.current?.abort();
    setStep({ kind: 'idle' });
  };

  const shown = step.kind === 'plan' || step.kind === 'importing' ? step.plan : null;
  const importable = shown ? partsToImport(shown, confirmed) : [];

  return (
    <Card
      title="Add files"
      subtitle="X's archive (the ZIP X sends), its analytics export (CSV) and its monthly Under the hood report (JSON). They are read on this computer and never sent anywhere."
    >
      <div
        className={styles.zone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void plan(e.dataTransfer.files);
        }}
        data-testid="vault-drop"
      >
        {step.kind === 'planning' ? (
          <Spinner size="tiny" label="Reading what you dropped…" />
        ) : (
          <>
            <DocumentArrowUp20Regular aria-hidden className={styles.icon} />
            <Body1 as="p">Drop X’s files here: the archive’s ZIP, the analytics CSV, or the Under the hood JSON</Body1>
            <Button size="sm" variant="primary" icon={<ArrowUpload16Regular />} onClick={() => input.current?.click()}>
              Choose files
            </Button>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={VAULT_ACCEPT}
        data-testid="vault-input"
        onChange={(e) => void plan(e.target.files)}
      />
      {error && (
        <Body1 as="p" role="alert" className={styles.alert}>
          {error}
        </Body1>
      )}
      {step.kind === 'done' && (
        <div role="status" aria-label="What came in">
          <ul className={styles.list}>
            {step.results.map((result) => (
              <li key={result.part.fingerprint} className={styles.line}>
                <CheckmarkCircle16Regular aria-hidden className={styles.good} />
                <Body1>{describeResult(result)}</Body1>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => document.getElementById(ledgerId)?.scrollIntoView({ block: 'start' })}
          >
            See the imports
          </Button>
        </div>
      )}
      <Modal
        open={!!shown}
        onClose={close}
        title="Import these files?"
        footer={
          step.kind === 'importing' ? (
            <>
              <Spinner size="tiny" label={step.progress} />
              <Button onClick={() => stop.current?.abort()}>Stop</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                data-autofocus
                disabled={!importable.length}
                onClick={() => shown && void run(shown)}
              >
                Import
              </Button>
            </>
          )
        }
      >
        {shown && (
          <>
            <Caption1 as="p" className={styles.muted}>
              For @{account.handle}. Nothing is written until you press Import.
            </Caption1>
            <ul className={styles.list} aria-label="Recognized">
              {shown.parts.map((part) => (
                <li key={part.fingerprint} className={styles.part}>
                  <span className={styles.line}>
                    <CheckmarkCircle16Regular aria-hidden className={styles.good} />
                    <Body1>
                      <strong>{part.parser.label}</strong>{' '}
                      <span className={styles.name}>
                        {part.fileName} · {megabytes(part.bytes)}
                      </span>
                    </Body1>
                  </span>
                  {part.duplicateOf && (
                    <Caption1 as="p" className={styles.warn}>
                      <Warning16Regular aria-hidden /> Already imported on {fmtDate(part.duplicateOf.importedAt)}:
                      importing it again adds nothing.
                    </Caption1>
                  )}
                  {part.confirm && (
                    <Checkbox
                      label={`${part.confirm} Yes, it’s @${account.handle}’s.`}
                      checked={confirmed.has(part)}
                      onChange={(_, data) =>
                        setConfirmed((prev) => {
                          const next = new Set(prev);
                          if (data.checked === true) next.add(part);
                          else next.delete(part);
                          return next;
                        })
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
            {!!shown.refused.length && (
              <ul className={styles.list} aria-label="Not imported">
                {shown.refused.map((refusal, i) => (
                  <li key={`${refusal.fileName}:${String(i)}`} className={styles.line}>
                    <ErrorCircle16Regular aria-hidden className={styles.bad} />
                    <Body1>
                      <strong className={styles.name}>{refusal.fileName}</strong>: {refusal.reason}
                    </Body1>
                  </li>
                ))}
              </ul>
            )}
            {!shown.parts.length && (
              <Body1 as="p" role="alert">
                Nothing here is one of X’s files that Xomoni reads. Nothing was imported.
              </Body1>
            )}
          </>
        )}
      </Modal>
    </Card>
  );
}
