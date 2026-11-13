import {
  Body1Strong,
  Caption1,
  Button as FluentButton,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  ArrowSync16Regular,
  Checkmark12Filled,
  ChevronDown16Regular,
  ChevronUp16Regular,
  Open16Regular,
  Play16Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import { type RunnerState, archiveJob } from '../../engine/runner';
import { workerTab } from '../../engine/worker-tab';
import { getSettings } from '../../shared/db';
import { nextActiveTime } from '../../shared/settings';
import type { Account } from '../../shared/types';
import { ARCHIVE_PAGE_URL, FIRST_LOOK_AFTER_MS, archiveOverdue, nextArchiveLook } from '../../shared/x-archive';
import {
  FOLDER_NOT_CHOSEN,
  type FolderPickerHost,
  type FolderStore,
  isArchiveFolder,
  kvFolderStore,
  pickArchiveFolder,
} from '../downloads-folder';
import { errorMessage, fmtAgo, fmtDate, fmtFinish } from '../format';
import { ensureConsent, startJob, toast, useRunner } from '../hooks';
import { type ArchiveStatus, useArchiveStatus } from '../queries';
import { ArchiveImport } from './ArchiveImport';
import { DownloadsWatch } from './DownloadsWatch';
import { Badge, Button, Card, useNow } from './ui';

/** The four steps of getting X's archive, as the card shows them (#186). */
export const ARCHIVE_STEPS = [
  { title: 'Ask X', detail: 'On X’s own page' },
  { title: 'X makes it', detail: 'Usually 1 to 3 days' },
  { title: 'Download', detail: 'Xomoni presses it on X' },
  { title: 'Import', detail: 'From Downloads › Xomoni' },
] as const;

/**
 * How far getting the archive went: the number of steps done (0 to 4), and whether the next one is under way now.
 * A request Xomoni gave up on, or none, starts over at the first step.
 */
export function archiveProgress(status: ArchiveStatus, now: number): { done: number; busy: boolean } {
  const { request, importedAt, openJob } = status;
  if (request?.downloadedAt != null) {
    return importedAt != null && importedAt >= request.downloadedAt
      ? { done: 4, busy: false }
      : { done: 3, busy: true };
  }
  if (request && !archiveOverdue(request, now)) return { done: 1, busy: true };
  return { done: 0, busy: !!openJob };
}

/** What the card says now, and the one thing it offers to do about it. */
interface ArchiveLine {
  text: string;
  tone: 'info' | 'attention';
  action?: 'open-x' | 'continue';
}

/**
 * The card's status line (#186): the job under way and what X needs from the person, the archive X is making and
 * when Xomoni looks again (inside active hours, while Xomoni is open), or the download waiting to come in. Null
 * when there is nothing to say.
 */
export function archiveLine(
  status: ArchiveStatus,
  context: {
    now: number;
    run: Pick<RunnerState, 'jobId' | 'status' | 'need' | 'message'>;
    folder: boolean;
    lookAt: number | null;
  },
): ArchiveLine | null {
  const { request, importedAt, openJob } = status;
  const { now, run, folder, lookAt } = context;
  if (openJob) {
    if (run.jobId === openJob.id) {
      if (run.status === 'attention') {
        return {
          tone: 'attention',
          action: 'open-x',
          text:
            run.need === 'identity'
              ? 'X asks you to confirm it’s you. Type your password on X’s page in the Xomoni window; Xomoni never sees it.'
              : run.message,
        };
      }
      return { tone: 'info', text: 'Xomoni is on X’s archive page.' };
    }
    return {
      tone: 'info',
      action: 'continue',
      text: openJob.stateReason ? `Stopped: ${openJob.stateReason}` : 'Ready to start.',
    };
  }
  if (!request) return null;
  if (request.downloadedAt != null) {
    if (importedAt != null && importedAt >= request.downloadedAt) return null;
    const ago = fmtAgo(request.downloadedAt, now);
    return {
      tone: 'info',
      text: folder
        ? `Downloaded from X ${ago}. Xomoni imports it from Downloads › Xomoni as soon as Chrome has saved it.`
        : `Downloaded from X ${ago} into Downloads › Xomoni. Choose that folder below, or drop the ZIP, to import it.`,
    };
  }
  if (archiveOverdue(request, now)) {
    return {
      tone: 'info',
      text: `X hasn’t made the archive Xomoni asked for on ${fmtDate(request.requestedAt)}. Ask X again.`,
    };
  }
  const when = lookAt == null || lookAt <= now ? 'soon' : fmtFinish(lookAt - now, now);
  const folderNote = folder ? '' : ' Choose the Xomoni folder below so it comes in by itself.';
  return {
    tone: 'info',
    text: `Asked X ${fmtAgo(request.requestedAt, now)}. X is making it; Xomoni looks again ${when}, while Xomoni is open, and downloads it.${folderNote}`,
  };
}

const useStyles = makeStyles({
  steps: {
    listStyleType: 'none',
    margin: `0 0 ${tokens.spacingVerticalM}`,
    padding: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalS,
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `${tokens.strokeWidthThicker} solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
  },
  stepDone: { borderTopColor: tokens.colorPaletteGreenBorderActive },
  stepCurrent: { borderTopColor: tokens.colorBrandStroke1 },
  stepTitle: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  check: { color: tokens.colorPaletteGreenForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  status: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: `0 0 ${tokens.spacingVerticalM}`,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorNeutralForeground1,
  },
  attention: {
    backgroundColor: tokens.colorStatusWarningBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusWarningBorder1}`,
  },
  statusText: { flexGrow: 1, flexBasis: '16rem' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  note: { display: 'block', margin: `${tokens.spacingVerticalS} 0 0`, color: tokens.colorNeutralForeground3 },
  byHand: { marginTop: tokens.spacingVerticalM },
  noWrap: { whiteSpace: 'nowrap' },
});

/** The four steps, the ones done ticked and the one under way marked as the current step. */
function Steps({ done, busy }: { done: number; busy: boolean }) {
  const s = useStyles();
  return (
    <ol className={s.steps} aria-label="Getting X’s archive">
      {ARCHIVE_STEPS.map((step, i) => {
        const isDone = i < done;
        const current = busy && i === done;
        return (
          <li
            key={step.title}
            className={mergeClasses(s.step, isDone && s.stepDone, current && s.stepCurrent)}
            aria-current={current ? 'step' : undefined}
            data-state={isDone ? 'done' : current ? 'current' : 'next'}
          >
            <span className={s.stepTitle}>
              {isDone && <Checkmark12Filled className={s.check} aria-label="Done:" />}
              <Body1Strong>{step.title}</Body1Strong>
            </span>
            <Caption1 className={s.muted}>{step.detail}</Caption1>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * X's archive (#186, ADR-0022), in four steps the person can follow without leaving the Library: *Get my archive*
 * makes Downloads › Xomoni and asks for it in the same click (once, #196), then runs the archive job; what it is
 * doing, and what X needs from the person, shows here. Consent comes before the job exists, so closing the dialog
 * leaves nothing behind. Doing it by hand stays one click away, folded unless it is the way left to import.
 */
export function XArchiveCard({
  account,
  store = kvFolderStore,
  host,
  makeFolder,
}: {
  account: Account;
  store?: FolderStore;
  host?: FolderPickerHost;
  /** Makes Downloads/Xomoni before the picker opens; `chrome.downloads` by default, a stand-in in tests. */
  makeFolder?: () => Promise<boolean>;
}) {
  const s = useStyles();
  const status = useArchiveStatus(account.id);
  const settings = useLiveQuery(getSettings, []);
  const folder = useLiveQuery(() => store.get(), [store]);
  const run = useRunner();
  const now = useNow(30_000);
  const panelId = useId();
  const pickerHost = host ?? (window as unknown as FolderPickerHost);
  const canWatch = typeof pickerHost.showDirectoryPicker === 'function';
  const [byHand, setByHand] = useState(!canWatch);

  const busy = run.status !== 'idle';
  const hasFolder = !!folder && isArchiveFolder(folder);
  const due = status?.request ? nextArchiveLook(status.request, now) : null;
  const lookAt = due != null && settings ? nextActiveTime(settings.activeHours, due) : due;
  const line = status ? archiveLine(status, { now, run, folder: hasFolder, lookAt }) : null;
  const progress = status ? archiveProgress(status, now) : { done: 0, busy: false };
  const waiting = progress.done === 1;
  const lookable = waiting && !!status?.request && now >= status.request.requestedAt + FIRST_LOOK_AFTER_MS;
  const downloadWaiting = progress.done === 3;
  const openJob = status?.openJob ?? null;
  // Folded unless it is the way left to import: a download waiting with no Downloads folder to read it from.
  const showByHand = byHand || (downloadWaiting && !hasFolder);

  const start = async (mode: 'get' | 'look') => {
    try {
      if (!(await ensureConsent(account.id))) return;
      // Asked in the same click, once, so the ZIP comes in by itself later; the job starts either way.
      if (mode === 'get' && canWatch && !hasFolder) {
        const pick = await pickArchiveFolder(store, pickerHost, makeFolder);
        if (pick.problem) toast(pick.problem, pick.problem === FOLDER_NOT_CHOSEN ? 'neutral' : 'critical');
      }
      const job = await archiveJob(account.id, mode);
      await startJob(job.id);
    } catch (err) {
      toast(`The job could not be saved: ${errorMessage(err)}`, 'critical');
    }
  };

  return (
    <Card
      title="X’s archive"
      subtitle="X’s own copy, the only complete one: every post, reply and like, even those X no longer shows."
      actions={
        status?.imported ? (
          <Badge tone="good">{status.importedAt ? `Last imported ${fmtDate(status.importedAt)}` : 'Imported'}</Badge>
        ) : undefined
      }
    >
      <Steps done={progress.done} busy={progress.busy} />
      {line && (
        <div className={mergeClasses(s.status, line.tone === 'attention' && s.attention)}>
          <Caption1 role="status" className={s.statusText}>
            {line.text}
          </Caption1>
          {line.action === 'open-x' && (
            <Button
              size="sm"
              variant="primary"
              icon={<Open16Regular />}
              className={s.noWrap}
              onClick={() => void workerTab.focus().catch((e: unknown) => toast(errorMessage(e), 'critical'))}
            >
              Open X window
            </Button>
          )}
          {line.action === 'continue' && openJob && (
            <Button
              size="sm"
              variant="primary"
              icon={<Play16Regular />}
              className={s.noWrap}
              disabled={busy}
              onClick={() => void startJob(openJob.id)}
            >
              Continue
            </Button>
          )}
        </div>
      )}
      <div className={s.actions}>
        {/* Nothing to ask X while X makes the archive, or while the one downloaded waits to come in. */}
        {!openJob && !waiting && !downloadWaiting && (
          <Button
            variant="primary"
            icon={<ArrowDownload16Regular />}
            disabled={busy || !status}
            onClick={() => void start('get')}
          >
            Get my archive
          </Button>
        )}
        {lookable && !openJob && (
          <Button icon={<ArrowSync16Regular />} disabled={busy} onClick={() => void start('look')}>
            Look now
          </Button>
        )}
        {/* A real link, so the browser opens X in a new tab; Fluent styles it as a button. */}
        <FluentButton
          as="a"
          href={ARCHIVE_PAGE_URL}
          target="_blank"
          rel="noreferrer"
          appearance="subtle"
          icon={<Open16Regular />}
        >
          Open X’s page
        </FluentButton>
      </div>
      {!openJob && !waiting && !downloadWaiting && (
        <Caption1 as="p" className={s.note}>
          {busy
            ? 'Another job is running; Get my archive waits until it finishes or you pause it.'
            : 'Xomoni presses X’s own buttons in its X window. If X asks for your password or a code, type it there: Xomoni never sees it.'}
          {!busy &&
            canWatch &&
            !hasFolder &&
            ' Chrome then opens your Downloads once: open the Xomoni folder there and press Select, so the archive comes in by itself.'}
        </Caption1>
      )}
      {/* Mounted again once the Get click chose the folder, so it starts watching at once. */}
      <DownloadsWatch
        key={hasFolder ? 'folder' : 'none'}
        account={account}
        store={store}
        host={host}
        makeFolder={makeFolder}
      />
      <div className={s.byHand}>
        <FluentButton
          appearance="transparent"
          size="small"
          icon={showByHand ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
          aria-expanded={showByHand}
          aria-controls={panelId}
          onClick={() => setByHand((open) => !open)}
        >
          Already have the ZIP?
        </FluentButton>
        <div id={panelId}>{showByHand && <ArchiveImport account={account} />}</div>
      </div>
    </Card>
  );
}
