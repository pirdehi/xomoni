import {
  Body1,
  Button as FluentButton,
  Caption1,
  CompoundButton,
  Link,
  SearchBox,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  Archive16Regular,
  Archive20Regular,
  ArrowDownload16Regular,
  ArrowReply20Regular,
  ChevronLeft16Regular,
  ChevronRight16Regular,
  Compose20Regular,
  DocumentJavascript16Regular,
  FolderOpen16Regular,
  Heart20Regular,
  History20Regular,
  LockClosed12Regular,
  Open16Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createScanJob } from '../../engine/runner';
import { db } from '../../shared/db';
import type { ItemKind, ScanTarget } from '../../shared/types';
import type { PageProps } from '../navigation';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, Segmented } from '../components/ui';
import {
  KIND_PLURAL,
  TARGET_PLURAL,
  downloadFile,
  errorMessage,
  fmtDate,
  fmtNumber,
  postUrl,
  toDateInput,
} from '../format';
import { startJob, toast, useRunner } from '../hooks';
import { importArchive } from '../importArchive';
import { useKindCounts } from '../queries';

const PAGE_SIZE = 25;

const useStyles = makeStyles({
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    '@media (min-width: 1024px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  below: { marginTop: tokens.spacingVerticalL },

  // Import card.
  steps: {
    margin: `0 0 ${tokens.spacingVerticalL}`,
    paddingLeft: tokens.spacingHorizontalL,
    listStyleType: 'decimal',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
    '& > li + li': { marginTop: tokens.spacingVerticalXS },
  },
  emphasis: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  mono: { fontFamily: tokens.fontFamilyMonospace, color: tokens.colorNeutralForeground1 },
  dropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  dropIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    marginBottom: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  dropText: { margin: 0, color: tokens.colorNeutralForeground1 },
  dropActions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalM,
  },
  busy: { color: tokens.colorNeutralForeground2 },
  error: { marginTop: tokens.spacingVerticalM },
  note: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground3,
  },

  // Scan card.
  scans: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalS,
    '@media (min-width: 640px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  scan: {
    width: '100%',
    maxWidth: 'none',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
  },
  scanIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '32px',
    height: '32px',
    fontSize: '20px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  scanIconDisabled: {
    backgroundColor: tokens.colorNeutralBackgroundDisabled,
    color: tokens.colorNeutralForegroundDisabled,
  },
  scanBody: { marginTop: tokens.spacingVerticalXXS, lineHeight: tokens.lineHeightBase200 },

  // Browser card.
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalM}`,
  },
  search: {
    width: '100%',
    marginLeft: 'auto',
    '@media (min-width: 640px)': { width: '256px' },
  },
  scroll: { overflowX: 'auto' },
  table: { minWidth: '640px' },
  headRow: {
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  head: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  headEnd: { justifyContent: 'flex-end' },
  row: { ':last-child': { borderBottomStyle: 'none' } },
  cell: {
    verticalAlign: 'top',
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
  },
  first: { paddingLeft: tokens.spacingHorizontalXL },
  last: { paddingRight: tokens.spacingHorizontalXL, textAlign: 'right' },
  dateCol: { width: '96px' },
  likesCol: { width: '64px' },
  sourceCol: { width: '112px' },
  linkCol: { width: '24px' },
  date: {
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground2,
  },
  likedEst: {
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase100,
    color: tokens.colorNeutralForeground3,
  },
  // At most two lines of a post; longer text is cut at the second line.
  text: {
    maxHeight: `calc(2 * ${tokens.lineHeightBase300})`,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
  },
  author: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  muted: { color: tokens.colorNeutralForeground3 },
  likes: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground2,
  },
  sources: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXS },
  open: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground3,
    ':hover': { color: tokens.colorBrandForeground1, backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXL}`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  pageInfo: { fontVariantNumeric: 'tabular-nums', color: tokens.colorNeutralForeground2 },
  pager: { display: 'flex', gap: tokens.spacingHorizontalXS },
});

/**
 * The local inventory: X archive import, scan jobs that only read X, and a paged browser of known
 * items with JSON export. Nothing on this page changes anything on X.
 */
export function InventoryPage({ account, navigate }: PageProps) {
  const styles = useStyles();
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Everything Xomoni knows about your account. Fill it from your official X archive (complete) and/or by scanning X (recent)."
      />
      <div className={styles.columns}>
        <ImportCard account={account} />
        <ScanCard accountId={account.id} navigate={navigate} />
      </div>
      <div className={styles.below}>
        <Browser accountId={account.id} handle={account.handle} />
      </div>
    </>
  );
}

function ImportCard({ account }: Pick<PageProps, 'account'>) {
  const styles = useStyles();
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const run = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setBusy('Starting…');
    try {
      const r = await importArchive([...list], account, setBusy);
      toast(`Imported ${fmtNumber(r.tweets)} posts and ${fmtNumber(r.likes)} likes`, 'good');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (folderInput.current) folderInput.current.value = '';
      if (filesInput.current) filesInput.current.value = '';
    }
  };

  return (
    <Card
      title="Import your X archive"
      subtitle="The only complete list of your posts and likes — including ones X no longer shows."
    >
      <ol className={styles.steps}>
        <li>
          On X: <span className={styles.emphasis}>Settings → Your account → Download an archive of your data</span>{' '}
          (ready in 24–72h).
        </li>
        <li>
          Unzip it, then choose its <span className={styles.mono}>data</span> folder below.
        </li>
      </ol>
      <div
        className={styles.dropZone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void run(e.dataTransfer.files);
        }}
      >
        {busy ? (
          <Spinner size="tiny" label={{ children: busy, className: styles.busy }} />
        ) : (
          <>
            <span className={styles.dropIcon}>
              <Archive20Regular aria-hidden />
            </span>
            <Body1 as="p" className={styles.dropText}>
              Drop account.js, tweets.js and like.js here
            </Body1>
            <div className={styles.dropActions}>
              <Button
                size="sm"
                variant="primary"
                icon={<FolderOpen16Regular />}
                onClick={() => folderInput.current?.click()}
              >
                Choose data folder
              </Button>
              <Button size="sm" icon={<DocumentJavascript16Regular />} onClick={() => filesInput.current?.click()}>
                Choose files
              </Button>
            </div>
          </>
        )}
      </div>
      <input ref={folderInput} type="file" multiple hidden onChange={(e) => void run(e.target.files)} />
      <input ref={filesInput} type="file" multiple accept=".js" hidden onChange={(e) => void run(e.target.files)} />
      {error && (
        <div className={styles.error}>
          <Callout tone="critical" icon={<Archive16Regular />}>
            {error}
          </Callout>
        </div>
      )}
      <Caption1 as="p" className={styles.note}>
        <LockClosed12Regular aria-hidden />
        Files are read locally. Only account.js, tweets.js and like.js are opened.
      </Caption1>
    </Card>
  );
}

const SCANS: { target: ScanTarget; title: string; body: string; icon: ReactNode }[] = [
  {
    target: 'posts',
    title: 'Posts & reposts',
    body: 'Your profile timeline (about the latest 3,200).',
    icon: <Compose20Regular />,
  },
  { target: 'replies', title: 'Replies', body: 'Your replies timeline.', icon: <ArrowReply20Regular /> },
  { target: 'likes', title: 'Likes', body: 'Your Likes page (recent likes).', icon: <Heart20Regular /> },
  {
    target: 'history',
    title: 'Full history',
    body: 'Searches X half-year by half-year back to when you joined.',
    icon: <History20Regular />,
  },
];

function ScanCard({ accountId, navigate }: { accountId: string; navigate: PageProps['navigate'] }) {
  const styles = useStyles();
  const run = useRunner();
  const busy = run.status !== 'idle';
  const scan = async (target: ScanTarget, title: string) => {
    try {
      const job = await createScanJob(accountId, `Scan: ${title}`, target);
      void startJob(job.id);
      navigate('jobs');
    } catch (err) {
      toast(`The scan could not be saved: ${errorMessage(err)}`, 'critical');
    }
  };
  return (
    <Card
      title="Scan from X"
      subtitle="Scrolls pages of X in the worker window and records what it sees. Nothing is changed."
    >
      <div className={styles.scans}>
        {SCANS.map((s) => (
          <CompoundButton
            key={s.target}
            className={styles.scan}
            icon={{ className: mergeClasses(styles.scanIcon, busy && styles.scanIconDisabled), children: s.icon }}
            secondaryContent={{ className: styles.scanBody, children: s.body }}
            disabled={busy}
            onClick={() => void scan(s.target, s.title)}
          >
            {s.title}
          </CompoundButton>
        ))}
      </div>
      <Caption1 as="p" className={styles.note}>
        Tip: Xomoni also records your own posts whenever you browse your profile in the worker window.
      </Caption1>
    </Card>
  );
}

function Browser({ accountId, handle }: { accountId: string; handle: string }) {
  const styles = useStyles();
  const [kind, setKind] = useState<ItemKind>('post');
  const [status, setStatus] = useState<'present' | 'deleted'>('present');
  const [query, setQuery] = useState('');
  // The page number belongs to one filter; changing the kind, status or search starts again at page 1.
  const filterKey = `${kind}|${status}|${query}`;
  const [paging, setPaging] = useState({ filterKey, page: 0 });
  // Adjusting state while rendering (React's pattern for state derived from props): a new filter forgets the old
  // page, so coming back to an earlier filter starts at page 1 too.
  if (paging.filterKey !== filterKey) setPaging({ filterKey, page: 0 });
  const page = paging.filterKey === filterKey ? paging.page : 0;
  const setPage = (next: number) => setPaging({ filterKey, page: next });
  const counts = useKindCounts(accountId);
  const total = counts?.[kind][status] ?? 0;

  const rows = useLiveQuery(() => {
    let coll = db.items
      .where('[accountId+kind+status+createdAt]')
      .between([accountId, kind, status, -Infinity], [accountId, kind, status, Infinity])
      .reverse();
    const q = query.trim().toLowerCase();
    // Authors are stored without the "@" the rows show and the search box suggests.
    const author = q.replace(/^@/, '');
    if (q) coll = coll.filter((i) => i.text.toLowerCase().includes(q) || i.author.toLowerCase().includes(author));
    return coll
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray();
  }, [accountId, kind, status, query, page]);

  const exportAll = async () => {
    const all = await db.items
      .where('[accountId+kind+status+createdAt]')
      .between([accountId, kind, status, -Infinity], [accountId, kind, status, Infinity])
      .toArray();
    downloadFile(
      `xomoni-${TARGET_PLURAL[kind]}-${status}-${toDateInput(Date.now())}.json`,
      JSON.stringify(all, null, 2),
    );
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cell = (...extra: (string | false)[]) => mergeClasses(styles.cell, ...extra);
  return (
    <Card
      title="Browse"
      padded={false}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowDownload16Regular />}
          onClick={() => void exportAll()}
          disabled={!total}
        >
          Export JSON
        </Button>
      }
    >
      <div className={styles.toolbar}>
        <Segmented
          value={kind}
          onChange={setKind}
          options={(['post', 'reply', 'repost', 'like'] as ItemKind[]).map((k) => ({
            value: k,
            label: `${KIND_PLURAL[k]} ${counts ? fmtNumber(counts[k][status]) : ''}`,
          }))}
        />
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'present', label: 'On X' },
            { value: 'deleted', label: 'Removed' },
          ]}
        />
        <SearchBox
          className={styles.search}
          placeholder="Search text or @author"
          aria-label="Search text or @author"
          value={query}
          onChange={(_, data) => setQuery(data.value)}
          dismiss={{ 'aria-label': 'Clear search' }}
        />
      </div>
      {rows && !rows.length ? (
        <EmptyState
          icon={<Archive20Regular />}
          title="Nothing here"
          body={query ? 'No items match your search.' : 'Import your archive or run a scan to fill the inventory.'}
        />
      ) : (
        <div className={styles.scroll}>
          <Table size="small" className={styles.table}>
            <TableHeader>
              <TableRow className={styles.headRow}>
                <TableHeaderCell className={mergeClasses(styles.head, styles.first, styles.dateCol)}>
                  Date
                </TableHeaderCell>
                <TableHeaderCell className={styles.head}>Text</TableHeaderCell>
                <TableHeaderCell
                  className={mergeClasses(styles.head, styles.likesCol)}
                  button={{ className: styles.headEnd }}
                >
                  Likes
                </TableHeaderCell>
                <TableHeaderCell className={mergeClasses(styles.head, styles.sourceCol)}>Source</TableHeaderCell>
                <TableHeaderCell className={mergeClasses(styles.head, styles.last, styles.linkCol)} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((item) => (
                <TableRow key={item.key} className={styles.row}>
                  <TableCell className={cell(styles.first, styles.date)}>
                    {fmtDate(item.kind === 'like' ? (item.likedAt ?? item.createdAt) : item.createdAt)}
                    {item.kind === 'like' && item.likedAt && <div className={styles.likedEst}>liked (est.)</div>}
                  </TableCell>
                  <TableCell className={cell()}>
                    <div className={styles.text}>
                      {item.author && item.author.toLowerCase() !== handle.toLowerCase() && (
                        <span className={styles.author}>@{item.author} · </span>
                      )}
                      {item.text || <span className={styles.muted}>(no text recorded)</span>}
                    </div>
                  </TableCell>
                  <TableCell className={cell(styles.likes)}>
                    {item.kind === 'like' ? '—' : fmtNumber(item.likes)}
                  </TableCell>
                  <TableCell className={cell()}>
                    <div className={styles.sources}>
                      {item.sources.map((s) => (
                        <Badge key={s} tone={s === 'archive' ? 'neutral' : 'accent'}>
                          {s === 'archive' ? 'Archive' : 'Scan'}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className={cell(styles.last)}>
                    <Tooltip content="Open on X" relationship="label">
                      <Link
                        href={postUrl(
                          item.kind === 'repost' ? item.targetId || item.id : item.id,
                          item.kind === 'post' || item.kind === 'reply' ? handle : undefined,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.open}
                      >
                        <Open16Regular aria-hidden />
                      </Link>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className={styles.footer}>
        <Caption1 className={styles.pageInfo}>
          {query ? 'Filtered' : `${fmtNumber(total)} items`} · page {page + 1}
          {!query && ` of ${fmtNumber(pages)}`}
        </Caption1>
        <div className={styles.pager}>
          <FluentButton
            size="small"
            appearance="subtle"
            icon={<ChevronLeft16Regular />}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Prev
          </FluentButton>
          <FluentButton
            size="small"
            appearance="subtle"
            icon={<ChevronRight16Regular />}
            iconPosition="after"
            disabled={(rows?.length ?? 0) < PAGE_SIZE || (!query && page + 1 >= pages)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </FluentButton>
        </div>
      </div>
    </Card>
  );
}
