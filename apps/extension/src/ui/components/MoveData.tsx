import { Body1, Body1Strong, Caption1, Spinner, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  ArrowImport20Regular,
  ArrowSwap20Regular,
  CheckmarkCircle16Regular,
  ErrorCircle16Regular,
  LockClosed12Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import {
  type ImportNotice,
  type MoveResult,
  dismissImportNotice,
  dismissMoveOffer,
  exportData,
  importData,
  importNotice,
  moveOfferShown,
} from '../../shared/move';
import { type MoveCheck, MOVE_TABLES, checkMoveFile } from '../../shared/move-file';
import { downloadFile, errorMessage, fmtDate, fmtNumber, toDateInput } from '../format';
import { toast, useRunner } from '../hooks';
import { Button, Callout, Card, Modal } from './ui';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  steps: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground2,
    '& > li + li': { marginTop: tokens.spacingVerticalXS },
  },
  buttons: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  note: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    color: tokens.colorNeutralForeground3,
  },
  noteIcon: { flexShrink: 0, marginTop: '3px' },
  muted: { margin: 0, color: tokens.colorNeutralForeground3 },
  busy: { color: tokens.colorNeutralForeground2 },
  accounts: { margin: `${tokens.spacingVerticalS} 0`, paddingLeft: tokens.spacingHorizontalL },
  dialogText: { margin: `0 0 ${tokens.spacingVerticalS}` },
  offer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke2}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  offerIcon: { display: 'inline-flex', flexShrink: 0, color: tokens.colorBrandForeground1 },
  offerBody: { flexGrow: 1, flexBasis: '18rem', minWidth: 0 },
  offerTitle: { display: 'block', margin: 0, color: tokens.colorNeutralForeground1 },
  offerText: { margin: `${tokens.spacingVerticalXXS} 0 0`, color: tokens.colorNeutralForeground2 },
  // Under the buttons, on a line of its own, in the Settings card and in the offer alike.
  result: { flexBasis: '100%', margin: 0 },
  // The import's result with its Dismiss button beside it (#357).
  summary: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalS },
  summaryText: { flexGrow: 1, minWidth: 0 },
  // On Home and onboarding, where the offer was.
  imported: { marginBottom: tokens.spacingVerticalL },
});

/** The version of this Xomoni, written into the file so the other one can say where it came from. */
const appVersion = () => chrome.runtime.getManifest().version;

/** Where *Export everything* saves the file, dated by the local day. */
export const exportFileName = (now = Date.now()) => `xomoni-export-${toDateInput(now)}.json`;

/**
 * *Export everything* (#300): saves every moved table as one file in Downloads, says so in a toast, and says when
 * damaged records had to be left out. Answers the file's name, or null when the export failed, which a toast says too.
 * Settings' *Move your data* and the card that brings a zip install to its store (#304) both run it.
 */
export async function saveEverything(): Promise<string | null> {
  try {
    const { text, skipped } = await exportData({ app: appVersion() });
    const name = exportFileName();
    downloadFile(name, text);
    toast(`Saved ${name}. It stays on your computer: Xomoni never sends it anywhere.`, 'good');
    if (skipped) {
      toast(
        `${fmtNumber(skipped)} damaged ${skipped === 1 ? 'record was' : 'records were'} left out of the file.`,
        'critical',
      );
    }
    return name;
  } catch (err) {
    toast(`Couldn’t export: ${errorMessage(err)}`, 'critical');
    return null;
  }
}

/** The sum of every table's count. */
const total = (counts: Record<string, number>) => MOVE_TABLES.reduce((sum, t) => sum + (counts[t] ?? 0), 0);

/** What an import did, in the person's words. */
export function describeResult(result: MoveResult): string {
  const added = total(result.added);
  const updated = total(result.updated);
  const what =
    added + updated === 0
      ? 'Everything in the file was already here'
      : `Added ${fmtNumber(added)} ${added === 1 ? 'record' : 'records'} and updated ${fmtNumber(updated)} with newer copies`;
  return `${what}. Nothing was replaced with less or deleted, and nothing started on X.`;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'confirm'; check: MoveCheck }
  | { kind: 'error'; text: string };

/**
 * The last import's result, *Your data is here* (#357), with *Dismiss*: it stays, on any page that shows it, until the
 * person dismisses it (`importNotice`), not only until the page changes.
 */
function ImportSummary({ notice }: { notice: ImportNotice }) {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.result, styles.summary)}>
      <div role="status" className={styles.summaryText}>
        <Callout tone="good" icon={<CheckmarkCircle16Regular />} title="Your data is here">
          Imported from Xomoni {notice.app}. {describeResult(notice.result)}
        </Callout>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void dismissImportNotice().catch((err: unknown) => toast(errorMessage(err), 'critical'))}
      >
        Dismiss
      </Button>
    </div>
  );
}

/**
 * *Import from a file* (#300, ADR-0032): picks a file, checks all of it (`checkMoveFile`), shows what it holds and asks
 * to confirm, then merges it (`importData`). A refused file says why and changes nothing. Disabled while a job runs in
 * this tab; a job in another tab makes the import refuse, having written nothing. Once an import is done, its result
 * (*Your data is here*) shows until the person dismisses it (#357), here and wherever else the dashboard shows it.
 */
export function MoveImport({ label = 'Import from a file', primary = false }: { label?: string; primary?: boolean }) {
  const styles = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const run = useRunner();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const notice = useLiveQuery(importNotice, []);
  const running = run.status !== 'idle';

  const check = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setStep({ kind: 'busy', text: 'Checking the file…' });
    try {
      const checked = await checkMoveFile(file);
      setStep(checked.ok ? { kind: 'confirm', check: checked } : { kind: 'error', text: checked.message });
    } catch (err) {
      setStep({ kind: 'error', text: `Couldn’t read the file: ${errorMessage(err)}` });
    }
  };

  const merge = async (checked: MoveCheck) => {
    setStep({ kind: 'busy', text: 'Importing…' });
    try {
      const result = await importData(checked.file);
      if (result === 'busy') {
        setStep({ kind: 'error', text: 'A job is running. Pause it, then import. Nothing was imported.' });
        return;
      }
      // `importData` keeps the result, which shows until the person dismisses it (#357).
      setStep({ kind: 'idle' });
      toast(`Imported from Xomoni ${checked.summary.app}. ${describeResult(result)}`, 'good');
    } catch (err) {
      setStep({ kind: 'error', text: `Couldn’t import: ${errorMessage(err)}. Nothing was imported.` });
    }
  };

  const summary = step.kind === 'confirm' ? step.check.summary : null;
  return (
    <>
      {step.kind === 'busy' ? (
        <Spinner size="tiny" label={{ children: step.text, className: styles.busy }} />
      ) : (
        <Button
          variant={primary ? 'primary' : 'secondary'}
          icon={<ArrowImport20Regular />}
          disabled={running}
          onClick={() => input.current?.click()}
        >
          {label}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="move-file"
        onChange={(e) => void check(e.target.files?.[0])}
      />
      {running && step.kind === 'idle' && (
        <Caption1 as="p" className={mergeClasses(styles.muted, styles.result)}>
          Import waits until no job runs: pause it first.
        </Caption1>
      )}
      {step.kind === 'idle' && notice && <ImportSummary notice={notice} />}
      {step.kind === 'error' && (
        <div role="alert" className={styles.result}>
          <Callout tone="critical" icon={<ErrorCircle16Regular />} title="Not imported">
            {step.text}
          </Callout>
        </div>
      )}
      <Modal
        open={!!summary}
        onClose={() => setStep({ kind: 'idle' })}
        title="Import this data?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStep({ kind: 'idle' })}>
              Cancel
            </Button>
            <Button
              variant="primary"
              data-autofocus
              disabled={running}
              onClick={() => step.kind === 'confirm' && void merge(step.check)}
            >
              Import
            </Button>
          </>
        }
      >
        {summary && (
          <>
            <Body1 as="p" className={styles.dialogText}>
              From Xomoni {summary.app}, exported {fmtDate(summary.exportedAt)}. The file is complete: its checksum
              matches.
            </Body1>
            {summary.accounts.length > 0 && (
              <ul className={styles.accounts} aria-label="Accounts in the file">
                {summary.accounts.map((a) => (
                  <li key={a.id}>
                    <strong>@{a.handle || a.id}</strong>: {fmtNumber(a.posts)} posts, replies and reposts ·{' '}
                    {fmtNumber(a.likes)} likes · {fmtNumber(a.jobs)} jobs · {fmtNumber(a.logs)} log entries
                  </li>
                ))}
              </ul>
            )}
            <Body1 as="p" className={styles.dialogText}>
              Also {fmtNumber(summary.counts.daily)} days of numbers, {fmtNumber(summary.counts.incoming)} replies to
              you, your settings and Watch, and what keeps Xomoni within X’s limits.
            </Body1>
            <Body1 as="p" className={styles.dialogText}>
              It is added to what this Xomoni has: where both have something, the newer copy is kept, and nothing is
              deleted. Jobs that hadn’t finished arrive ended, and nothing starts on X.
            </Body1>
          </>
        )}
      </Modal>
    </>
  );
}

/**
 * Settings' *Move your data* (#300, ADR-0032): how to move to a new Xomoni (export here, import there), *Export
 * everything* and *Import from a file*. The file stays on the person's computer (ADR-0004).
 */
export function MoveDataCard() {
  const styles = useStyles();
  return (
    <Card
      title="Move your data"
      subtitle="Moving to a new Xomoni, such as the Chrome Web Store version? Chrome keeps each one’s data apart, so bring yours along."
    >
      <div className={styles.stack}>
        <ol className={styles.steps}>
          <li>
            In the Xomoni you’re leaving, choose <strong>Export everything</strong>. It saves one file in Downloads.
          </li>
          <li>
            In the new Xomoni, choose <strong>Import from a file</strong> and pick that file. It is checked, then added
            to what is there: nothing is replaced with less or deleted.
          </li>
        </ol>
        <div className={styles.buttons}>
          <Button icon={<ArrowDownload20Regular />} onClick={() => void saveEverything()}>
            Export everything
          </Button>
          <MoveImport />
        </div>
        <Caption1 as="p" className={styles.note}>
          <LockClosed12Regular aria-hidden className={styles.noteIcon} />
          The file stays on your computer: Xomoni never sends it anywhere. It holds your posts, likes and the replies
          others wrote to you, so keep it private, and import only a file you exported yourself.
        </Caption1>
      </div>
    </Card>
  );
}

/** Whether onboarding and Home offer the import, and the last import's result while it waits to be dismissed. */
const offerState = async () => ({ shown: await moveOfferShown(), notice: await importNotice() });

/**
 * The offer on a new install (#300): *Coming from another Xomoni? Import your data*, shown while this Xomoni hasn't
 * done anything yet (`moveOfferShown`) until the person dismisses it with *Not now*. After an import, the last import's
 * result (*Your data is here*) takes its place until the person dismisses it (#357), wherever the import was made:
 * importing from onboarding turns the dashboard to Home at once, and the result is waiting there. Renders nothing
 * otherwise.
 */
export function MoveOffer() {
  const styles = useStyles();
  // One query: the import's log line ends the offer in the same transaction that keeps its result, so the result
  // takes the offer's place without the section leaving the page in between.
  const state = useLiveQuery(offerState, []);
  if (state?.notice)
    return (
      <section aria-label="Move your data" className={styles.imported}>
        <ImportSummary notice={state.notice} />
      </section>
    );
  if (!state?.shown) return null;
  const dismiss = () => void dismissMoveOffer().catch((err: unknown) => toast(errorMessage(err), 'critical'));
  return (
    <section aria-label="Move your data" className={styles.offer}>
      <span className={styles.offerIcon} aria-hidden>
        <ArrowSwap20Regular />
      </span>
      <div className={styles.offerBody}>
        <Body1Strong as="h2" className={styles.offerTitle}>
          Coming from another Xomoni?
        </Body1Strong>
        <Body1 as="p" className={styles.offerText}>
          Import the file you saved there with <strong>Export everything</strong> (Settings › Move your data), and pick
          up where you left off.
        </Body1>
      </div>
      <div className={styles.buttons}>
        <MoveImport label="Import your data" primary />
        <Button variant="ghost" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
