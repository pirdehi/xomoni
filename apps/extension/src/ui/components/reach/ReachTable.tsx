import {
  Button as FluentButton,
  Caption1,
  Link,
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
import { ChevronLeft16Regular, ChevronRight16Regular, Open16Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { fmtDate, fmtNumber, postUrl } from '../../format';
import { type ReachFilter, type ReachRow, type ReachSort, filterRows, sortRows, vsUsualWords } from '../../reach';
import { Badge, Card, FieldGroup, Segmented } from '../ui';

/** Rows on one page of the table. */
export const REACH_PAGE_SIZE = 25;

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalM}`,
  },
  scroll: { overflowX: 'auto' },
  table: { minWidth: '720px' },
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
  numberCol: { width: '112px' },
  sourceCol: { width: '96px' },
  linkCol: { width: '56px' },
  date: {
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground2,
  },
  text: {
    maxHeight: `calc(2 * ${tokens.lineHeightBase300})`,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  number: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
  },
  growing: { marginTop: tokens.spacingVerticalXXS },
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
  empty: {
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL}`,
    color: tokens.colorNeutralForeground3,
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

/** The source of a post's number, as its badge says it. */
const SOURCE_BADGE = {
  csv: { label: 'CSV', tone: 'accent', hint: "From X's analytics export, as of the day it was made" },
  live: { label: 'Live', tone: 'neutral', hint: 'The views X last showed Xomoni on a page you opened' },
} as const;

/**
 * Each post of the period with its reach, a page of 25 at a time (#429, ADR-0045): when it was posted, its text, how
 * many times X says it was seen (and *still growing* when that was read before it was 7 days old), its share of its
 * usual reach, where the number comes from, and a link to it on X while it is still there. Filtered by kind and format,
 * sorted by date, reach or share of usual. Text is shown as text, never as markup.
 */
export function ReachTable({ rows, handle }: { rows: readonly ReachRow[]; handle: string }) {
  const styles = useStyles();
  const [filter, setFilter] = useState<ReachFilter>({ kind: 'all', format: 'all' });
  const [sort, setSort] = useState<ReachSort>('newest');
  // The page belongs to one filter and order; changing either starts again at page 1.
  const view = `${filter.kind}:${filter.format}:${sort}`;
  const [paging, setPaging] = useState({ view, page: 0 });
  const page = paging.view === view ? paging.page : 0;
  const shown = sortRows(filterRows(rows, filter), sort);
  const pages = Math.max(1, Math.ceil(shown.length / REACH_PAGE_SIZE));
  const slice = shown.slice(page * REACH_PAGE_SIZE, (page + 1) * REACH_PAGE_SIZE);
  const cell = (...extra: (string | false)[]) => mergeClasses(styles.cell, ...extra);
  const setPage = (next: number) => setPaging({ view, page: next });

  return (
    <Card title="Each post" subtitle="How many times X says each post was seen" padded={false}>
      <div className={styles.toolbar}>
        <FieldGroup label="Show">
          <Segmented
            value={filter.kind}
            onChange={(kind) => setFilter({ ...filter, kind })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'post', label: 'Posts' },
              { value: 'reply', label: 'Replies' },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="With">
          <Segmented
            value={filter.format}
            onChange={(format) => setFilter({ ...filter, format })}
            options={[
              { value: 'all', label: 'Anything' },
              { value: 'link', label: 'A link' },
              { value: 'media', label: 'Photos or videos' },
              { value: 'text', label: 'Text only' },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Sort by">
          <Segmented
            value={sort}
            onChange={setSort}
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'most-seen', label: 'Most seen' },
              { value: 'vs-usual', label: 'Below usual' },
            ]}
          />
        </FieldGroup>
      </div>
      {!slice.length ? (
        <p className={styles.empty}>No posts match.</p>
      ) : (
        <div className={styles.scroll}>
          <Table size="small" className={styles.table} aria-label="Each post's reach">
            <TableHeader>
              <TableRow className={styles.headRow}>
                <TableHeaderCell className={mergeClasses(styles.head, styles.first, styles.dateCol)}>
                  Date
                </TableHeaderCell>
                <TableHeaderCell className={styles.head}>Post</TableHeaderCell>
                <TableHeaderCell
                  className={mergeClasses(styles.head, styles.numberCol)}
                  button={{ className: styles.headEnd }}
                >
                  Seen
                </TableHeaderCell>
                <TableHeaderCell
                  className={mergeClasses(styles.head, styles.numberCol)}
                  button={{ className: styles.headEnd }}
                >
                  Vs usual
                </TableHeaderCell>
                <TableHeaderCell className={mergeClasses(styles.head, styles.sourceCol)}>Source</TableHeaderCell>
                <TableHeaderCell className={mergeClasses(styles.head, styles.last, styles.linkCol)}>
                  <span className={styles.muted}>Link</span>
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.map((row) => {
                const source = row.source ? SOURCE_BADGE[row.source] : null;
                return (
                  <TableRow key={row.id} className={styles.row} data-post={row.id}>
                    <TableCell className={cell(styles.first, styles.date)}>{fmtDate(row.createdAt)}</TableCell>
                    <TableCell className={cell()}>
                      <div className={styles.text}>
                        {row.kind === 'reply' && <span className={styles.muted}>Reply · </span>}
                        {row.text || <span className={styles.muted}>(no text recorded)</span>}
                      </div>
                    </TableCell>
                    <TableCell className={cell(styles.number)}>
                      {row.impressions === null ? '—' : fmtNumber(row.impressions)}
                      {row.growing && (
                        <div className={styles.growing}>
                          <Tooltip
                            content="Read before it was 7 days old: it may still grow, so it isn't compared yet."
                            relationship="description"
                          >
                            <span>
                              <Badge tone="warn">Still growing</Badge>
                            </span>
                          </Tooltip>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className={cell(styles.number)}>
                      {row.growing ? '—' : vsUsualWords(row.vsBaseline)}
                    </TableCell>
                    <TableCell className={cell()}>
                      {source && (
                        <Tooltip content={source.hint} relationship="description">
                          <span>
                            <Badge tone={source.tone}>{source.label}</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell className={cell(styles.last)}>
                      {row.onX && (
                        <Tooltip content="Open on X" relationship="label">
                          <Link href={postUrl(row.id, handle)} target="_blank" rel="noreferrer" className={styles.open}>
                            <Open16Regular aria-hidden />
                          </Link>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <div className={styles.footer}>
        <Caption1 className={styles.pageInfo}>
          {fmtNumber(shown.length)} {shown.length === 1 ? 'post' : 'posts'} · page {page + 1} of {fmtNumber(pages)}
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
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </FluentButton>
        </div>
      </div>
    </Card>
  );
}
