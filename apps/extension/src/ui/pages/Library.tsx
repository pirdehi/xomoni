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
  TaskListLtr20Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useState } from 'react';
import { createScanJob } from '../../engine/runner';
import type { Account, ScanTarget } from '../../shared/types';
import { ARCHIVE_PAGE_URL } from '../../shared/x-archive';
import { DownloadCopyDialog } from '../components/DownloadCopy';
import { ItemBrowser } from '../components/ItemBrowser';
import { XArchiveCard } from '../components/XArchiveCard';
import { Badge, Button, Card, Disclosure, PageHeader } from '../components/ui';
import { errorMessage, fmtAgo, fmtNumber } from '../format';
import { startJob, toast, useRunner } from '../hooks';
import type { PageProps } from '../navigation';
import { type CopyStatus, useCopyStatus } from '../queries';

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
  below: { marginTop: tokens.spacingVerticalL },
  progress: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS },
  muted: { color: tokens.colorNeutralForeground3 },
  // The sources as one row of chips, so the archive below is what stands out (#203).
  sources: {
    listStyleType: 'none',
    margin: `${tokens.spacingVerticalM} 0 ${tokens.spacingVerticalL}`,
    padding: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
  },
  source: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusCircular,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  sourceIcon: { display: 'inline-flex', flexShrink: 0, color: tokens.colorBrandForeground1 },
  sourceText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  other: {
    marginTop: tokens.spacingVerticalL,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  otherText: { display: 'block', margin: `0 0 ${tokens.spacingVerticalM}`, color: tokens.colorNeutralForeground2 },
  badge: { flexShrink: 0, whiteSpace: 'nowrap' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  note: { display: 'block', margin: `${tokens.spacingVerticalM} 0 0`, color: tokens.colorNeutralForeground3 },
});

/** One source of the copy as a chip, with whether and when it was last read or imported; `detail` is its tooltip. */
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
    <li className={s.source} data-done={done} title={detail}>
      <span className={s.sourceIcon} aria-hidden>
        {icon}
      </span>
      <span className={s.sourceText}>
        <Body1Strong>{title}</Body1Strong>
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
 * How complete Xomoni's copy is, in one card (#185, #203): X's count against what Xomoni has, each source with when it
 * was last read, X's archive as the recommended way to complete it, and reading from X folded under *Other ways*:
 * one job that reads everything a read can reach (`complete`), or one part alone. A read already under way is shown
 * instead of a second one.
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
  const lastRead = Math.max(status?.recentAt ?? 0, status?.historyAt ?? 0);
  const readsSummary = status?.openRead
    ? 'A read from X is under way.'
    : readBefore
      ? `Last read from X ${fmtAgo(lastRead)}.`
      : 'Xomoni can also read your account straight from X, while X makes the archive.';
  return (
    <Card title="Your copy" subtitle={`Everything Xomoni has of @${account.handle}, kept on this computer.`}>
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
      <XArchiveCard account={account} bare />
      <div className={s.other}>
        <Disclosure label="Other ways: read from X" summary={readsSummary}>
          <Caption1 as="p" className={s.otherText}>
            Xomoni reads your profile, replies and likes, and X search back to when you joined. It misses old posts
            nobody liked, which only X’s archive has.
          </Caption1>
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
            A read only looks: nothing on X changes. It goes at the same careful pace as everything else, within your
            active hours, and you can follow it in Activity.
          </Caption1>
        </Disclosure>
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
      <CopyCard account={account} navigate={navigate} />
      <div className={s.below}>
        <ItemBrowser accountId={account.id} handle={account.handle} />
      </div>
      <DownloadCopyDialog account={account} open={downloading} onClose={() => setDownloading(false)} />
    </>
  );
}
