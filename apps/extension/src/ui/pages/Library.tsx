import {
  Body1Strong,
  Caption1,
  Button as FluentButton,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  ProgressBar,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  ArrowSync16Regular,
  Archive20Regular,
  ChevronDown16Regular,
  Compose20Regular,
  History20Regular,
  Open16Regular,
  TaskListLtr20Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useState } from 'react';
import { archiveJob, createScanJob } from '../../engine/runner';
import type { Account, ScanTarget } from '../../shared/types';
import { ARCHIVE_PAGE_URL, type ArchiveMode, archiveOverdue, nextArchiveLook } from '../../shared/x-archive';
import { ArchiveImport } from '../components/ArchiveImport';
import { DownloadCopyDialog } from '../components/DownloadCopy';
import { DownloadsWatch } from '../components/DownloadsWatch';
import { ItemBrowser } from '../components/ItemBrowser';
import { Badge, Button, Card, PageHeader, useNow } from '../components/ui';
import { errorMessage, fmtAgo, fmtDate, fmtFinish, fmtNumber } from '../format';
import { startJob, toast, useRunner } from '../hooks';
import type { PageProps } from '../navigation';
import { type ArchiveStatus, type CopyStatus, useArchiveStatus, useCopyStatus } from '../queries';

/** X's page for requesting the official archive. The person confirms it there with their password, never Xomoni. */
export const X_ARCHIVE_URL = ARCHIVE_PAGE_URL;

/** The title of the job *Complete my copy* starts. */
export const COMPLETE_TITLE = 'Complete my copy';

/** Reads of one part only, for people who want just that. */
const PARTS: { target: ScanTarget; label: string }[] = [
  { target: 'posts', label: 'Posts and reposts (about the newest 3,200)' },
  { target: 'replies', label: 'Replies' },
  { target: 'likes', label: 'Likes (recent ones)' },
  { target: 'history', label: 'Full history (X search)' },
];

const useStyles = makeStyles({
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    '@media (min-width: 1024px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  below: { marginTop: tokens.spacingVerticalL },
  progress: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS },
  muted: { color: tokens.colorNeutralForeground3 },
  sources: {
    listStyleType: 'none',
    margin: `${tokens.spacingVerticalL} 0`,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
  },
  source: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  sourceIcon: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: '32px',
    height: '32px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  sourceText: { display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 },
  badge: { flexShrink: 0, whiteSpace: 'nowrap' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  note: { display: 'block', margin: `${tokens.spacingVerticalM} 0 0`, color: tokens.colorNeutralForeground3 },
  status: {
    display: 'block',
    margin: `0 0 ${tokens.spacingVerticalM}`,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorNeutralForeground1,
  },
  byHand: { marginTop: tokens.spacingVerticalM },
});

/** One source of the copy, with whether and when it was last read or imported. */
function Source({
  icon,
  title,
  detail,
  at,
  done,
  doneLabel,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  at: number | null;
  done: boolean;
  doneLabel: string;
}) {
  const s = useStyles();
  return (
    <li className={s.source} data-done={done}>
      <span className={s.sourceIcon} aria-hidden>
        {icon}
      </span>
      <span className={s.sourceText}>
        <Body1Strong>{title}</Body1Strong>
        <Caption1 className={s.muted}>{detail}</Caption1>
      </span>
      <span className={s.badge}>
        {done ? <Badge tone="good">{at ? `${doneLabel} ${fmtAgo(at)}` : doneLabel}</Badge> : <Badge>Not yet</Badge>}
      </span>
    </li>
  );
}

/** How much of X's own count Xomoni has, as a bar, or why that isn't known yet. */
function Coverage({ status, handle }: { status: CopyStatus; handle: string }) {
  const s = useStyles();
  const { postsCount, unseen } = status;
  if (postsCount == null || unseen == null || postsCount === 0) {
    return (
      <Caption1 as="p" className={s.muted}>
        {fmtNumber(status.present)} posts, replies and reposts so far. X’s own count shows up here once Xomoni has read
        your profile.
      </Caption1>
    );
  }
  const have = Math.max(0, postsCount - unseen);
  const share = Math.min(1, have / postsCount);
  const label = `About ${Math.round(share * 100)}% of the ${fmtNumber(postsCount)} posts, replies and reposts X counts for @${handle}`;
  return (
    <div className={s.progress}>
      <ProgressBar
        value={share}
        thickness="large"
        color={share >= 0.98 ? 'success' : 'brand'}
        aria-label={label}
        aria-valuetext={`${Math.round(share * 100)}%`}
      />
      <Caption1>{label}.</Caption1>
    </div>
  );
}

/**
 * How complete Xomoni's copy is (#185): X's count against what Xomoni has, each source with when it was last read,
 * and one action that reads everything a read can reach in one job (`complete`). A read already under way is shown
 * instead of a second one; one part can still be read alone.
 */
function CopyCard({ account, navigate }: { account: Account; navigate: PageProps['navigate'] }) {
  const s = useStyles();
  const status = useCopyStatus(account);
  const run = useRunner();
  const busy = run.status !== 'idle';

  const read = async (target: ScanTarget, title: string) => {
    try {
      const job = await createScanJob(account.id, title, target);
      void startJob(job.id);
      navigate('jobs');
    } catch (err) {
      toast(`The read could not be saved: ${errorMessage(err)}`, 'critical');
    }
  };

  const readBefore = !!status && (status.recentAt != null || status.historyAt != null);
  return (
    <Card
      title="Your copy"
      subtitle="Xomoni reads your account from X and from X’s archive, and keeps what it finds on this computer."
    >
      {status && <Coverage status={status} handle={account.handle} />}
      <ul className={s.sources} aria-label="Sources">
        <Source
          icon={<Compose20Regular />}
          title="Recent posts, replies and likes"
          detail="Your profile, replies and likes on X."
          at={status?.recentAt ?? null}
          done={status?.recentAt != null}
          doneLabel="Read"
        />
        <Source
          icon={<History20Regular />}
          title="Full history"
          detail="X search, half a year at a time, back to when you joined. It misses old posts nobody liked."
          at={status?.historyAt ?? null}
          done={status?.historyAt != null}
          doneLabel="Read"
        />
        <Source
          icon={<Archive20Regular />}
          title="X’s archive"
          detail="X’s own copy, the only complete one."
          at={status?.archive.importedAt ?? null}
          done={!!status?.archive.imported}
          doneLabel="Imported"
        />
      </ul>
      <div className={s.actions}>
        {status?.openRead ? (
          <Button variant="primary" icon={<TaskListLtr20Regular />} onClick={() => navigate('jobs')}>
            See the read under way
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={readBefore ? <ArrowSync16Regular /> : <ArrowDownload16Regular />}
            disabled={busy || !status}
            onClick={() => void read('complete', COMPLETE_TITLE)}
          >
            {readBefore ? 'Read X again' : 'Complete my copy'}
          </Button>
        )}
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <FluentButton appearance="subtle" icon={<ChevronDown16Regular />} iconPosition="after" disabled={busy}>
              Read one part
            </FluentButton>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {PARTS.map((part) => (
                <MenuItem key={part.target} onClick={() => void read(part.target, `Read: ${part.label}`)}>
                  {part.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      <Caption1 as="p" className={s.note}>
        A read only looks: nothing on X changes. It goes at the same careful pace as everything else, within your active
        hours, and you can follow it in Jobs.
      </Caption1>
    </Card>
  );
}

/** What the archive card says about the archive Xomoni is getting from X (#186), or null when there is nothing to say. */
function archiveLine(status: ArchiveStatus, now: number): string | null {
  const { request, importedAt } = status;
  if (!request) return null;
  if (request.downloadedAt != null) {
    if (importedAt != null && importedAt >= request.downloadedAt) return null;
    return `Downloaded from X ${fmtAgo(request.downloadedAt, now)}. Xomoni imports it as soon as the ZIP is in your Downloads folder.`;
  }
  if (archiveOverdue(request, now)) {
    return `X hasn’t made the archive Xomoni asked for on ${fmtDate(request.requestedAt)}. Ask X again.`;
  }
  const next = nextArchiveLook(request, now);
  const when = next == null || next <= now ? 'soon' : fmtFinish(next - now, now);
  return `Asked X ${fmtAgo(request.requestedAt, now)}. X is making it; Xomoni looks again ${when} and downloads it.`;
}

/**
 * X's archive (#186, ADR-0022): one button gets it. Xomoni asks X for it on X's own page and downloads it when X has
 * made it; the person only types their password there if X asks. What it is doing shows here; the Downloads folder
 * watch and the drop zone bring the ZIP in, and X's page stays one click away for doing it by hand.
 */
function XArchiveCard({ account, navigate }: { account: Account; navigate: PageProps['navigate'] }) {
  const s = useStyles();
  const status = useArchiveStatus(account.id);
  const run = useRunner();
  const busy = run.status !== 'idle';
  const now = useNow(30_000);
  const line = status ? archiveLine(status, now) : null;
  const waiting = !!status?.request && nextArchiveLook(status.request, now) != null;

  const get = async (mode: ArchiveMode) => {
    try {
      const job = await archiveJob(account.id, mode);
      void startJob(job.id);
      navigate('jobs');
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
          <Badge tone="good">{status.importedAt ? `Imported ${fmtDate(status.importedAt)}` : 'Imported'}</Badge>
        ) : undefined
      }
    >
      {line && (
        <Caption1 as="p" role="status" className={s.status}>
          {line}
        </Caption1>
      )}
      <div className={s.actions}>
        {status?.openJob ? (
          <Button variant="primary" icon={<TaskListLtr20Regular />} onClick={() => navigate('jobs')}>
            See it in Jobs
          </Button>
        ) : waiting ? (
          <Button icon={<ArrowSync16Regular />} disabled={busy} onClick={() => void get('look')}>
            Look now
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={<ArrowDownload16Regular />}
            disabled={busy || !status}
            onClick={() => void get('get')}
          >
            Get my archive
          </Button>
        )}
        {/* A real link, so the browser opens X in a new tab; Fluent styles it as a button. */}
        <FluentButton
          as="a"
          href={X_ARCHIVE_URL}
          target="_blank"
          rel="noreferrer"
          appearance="subtle"
          icon={<Open16Regular />}
        >
          Open X’s page
        </FluentButton>
      </div>
      <Caption1 as="p" className={s.note}>
        Xomoni opens X’s archive page in its X window and presses X’s own buttons. If X asks for your password or a
        code, type it there: Xomoni never sees it. X takes a day or more to make the archive; Xomoni looks again by
        itself and downloads it.
      </Caption1>
      <DownloadsWatch account={account} />
      <div className={s.byHand}>
        <ArchiveImport account={account} />
      </div>
    </Card>
  );
}

/**
 * The Library (#185), which replaces the Archive and Inventory pages: how complete Xomoni's copy of the account is
 * and how to complete it, getting X's archive (#186), everything in it to browse, and *Download a copy* for any
 * dates. The only thing on this page that changes anything on X is *Get my archive*, which asks X for the archive.
 */
export function LibraryPage({ account, navigate }: PageProps) {
  const s = useStyles();
  const [downloading, setDownloading] = useState(false);
  return (
    <>
      <PageHeader
        title="Library"
        description={`Everything Xomoni has of @${account.handle}. It stays on this computer.`}
        actions={
          <Button icon={<ArrowDownload16Regular />} onClick={() => setDownloading(true)}>
            Download a copy
          </Button>
        }
      />
      <div className={s.columns}>
        <CopyCard account={account} navigate={navigate} />
        <XArchiveCard account={account} navigate={navigate} />
      </div>
      <div className={s.below}>
        <ItemBrowser accountId={account.id} handle={account.handle} />
      </div>
      <DownloadCopyDialog account={account} open={downloading} onClose={() => setDownloading(false)} />
    </>
  );
}
