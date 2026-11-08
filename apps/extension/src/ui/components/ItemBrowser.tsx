import {
  Button as FluentButton,
  Caption1,
  Link,
  SearchBox,
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
  Archive20Regular,
  ArrowDownload16Regular,
  ChevronLeft16Regular,
  ChevronRight16Regular,
  Open16Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../shared/db';
import type { ItemKind } from '../../shared/types';
import { KIND_PLURAL, TARGET_PLURAL, downloadFile, fmtDate, fmtNumber, postUrl, toDateInput } from '../format';
import { useKindCounts } from '../queries';
import { Badge, Button, Card, EmptyState, Segmented } from './ui';

const PAGE_SIZE = 25;

const useStyles = makeStyles({
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
 * Everything in the library, a page of 25 at a time: posts, replies, reposts or likes, still on X or removed, with a
 * search over text and authors, each row linked to X. *Export JSON* saves the list shown, whole.
 */
export function ItemBrowser({ accountId, handle }: { accountId: string; handle: string }) {
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
          body={
            query ? 'No items match your search.' : 'Import your X archive or complete your copy to fill the library.'
          }
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
