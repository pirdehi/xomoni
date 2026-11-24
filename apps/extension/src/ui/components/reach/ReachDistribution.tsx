import {
  Link,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useCallback, useState } from 'react';
import { fmtCompact, fmtDate, fmtNumber, postUrl } from '../../format';
import { type ReachRow, bestAndWorst, histogram } from '../../reach';
import { Card, Segmented } from '../ui';

const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 40 };

const useStyles = makeStyles({
  grid: {
    display: 'grid',
    gap: tokens.spacingHorizontalXL,
    gridTemplateColumns: '1fr',
    '@media (min-width: 900px)': { gridTemplateColumns: '1fr 1fr' },
  },
  plot: { position: 'relative' },
  svg: { display: 'block' },
  bar: { fill: tokens.colorCompoundBrandBackground },
  gridLine: { stroke: tokens.colorNeutralStroke2 },
  axis: { stroke: tokens.colorNeutralStroke1 },
  tick: {
    fill: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
    fontVariantNumeric: 'tabular-nums',
  },
  table: { fontVariantNumeric: 'tabular-nums' },
  headCell: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  endAlign: { justifyContent: 'flex-end' },
  numeric: { textAlign: 'right' },
  list: { margin: 0, padding: 0, listStyleType: 'none' },
  item: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'baseline',
    columnGap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} 0`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    ':last-child': { borderBottomStyle: 'none' },
  },
  date: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  text: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase300,
  },
  seen: { fontVariantNumeric: 'tabular-nums', fontSize: tokens.fontSizeBase200 },
  muted: { color: tokens.colorNeutralForeground3 },
});

/**
 * How the period's reach spreads (#429): how many posts were seen 0, 1 to 9, 10 to 99 times and so on, a scale of
 * tens, as a chart or the same numbers as a table; and the 10 most and least seen settled posts. A post still growing
 * isn't among them: it would look worse than it is.
 */
export function ReachDistribution({ rows, handle }: { rows: readonly ReachRow[]; handle: string }) {
  const styles = useStyles();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const bins = histogram(rows);
  const { best, worst } = bestAndWorst(rows);
  return (
    <div className={styles.grid}>
      <Card
        title="How your reach spreads"
        subtitle="Posts by how many times they were seen, on a scale of tens"
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        }
      >
        {view === 'table' ? (
          <Table size="small" className={styles.table} aria-label="Posts by how many times they were seen">
            <TableHeader>
              <TableRow>
                <TableHeaderCell className={styles.headCell}>Seen</TableHeaderCell>
                <TableHeaderCell className={styles.headCell} button={{ className: styles.endAlign }}>
                  Posts
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bins.map((b) => (
                <TableRow key={b.label}>
                  <TableCell>{b.label}</TableCell>
                  <TableCell className={styles.numeric}>{fmtNumber(b.count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Histogram bins={bins} />
        )}
      </Card>
      <Card title="Most and least seen" subtitle="Settled posts: read at least 7 days after you posted them">
        <PostList title="Most seen" rows={best} handle={handle} />
        <PostList title="Least seen" rows={worst} handle={handle} />
      </Card>
    </div>
  );
}

/** A short list of posts: date, text and how many times each was seen, linked to X while it is there. */
function PostList({ title, rows, handle }: { title: string; rows: readonly ReachRow[]; handle: string }) {
  const styles = useStyles();
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {rows.length ? (
        <ol className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.item} data-post={row.id}>
              <span className={styles.date}>{fmtDate(row.createdAt)}</span>
              <span className={styles.text}>
                {row.onX ? (
                  <Link href={postUrl(row.id, handle)} target="_blank" rel="noreferrer">
                    {row.text || 'Untitled post'}
                  </Link>
                ) : (
                  row.text || 'Untitled post'
                )}
              </span>
              <span className={styles.seen}>{fmtNumber(row.impressions ?? 0)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No settled posts yet.</p>
      )}
    </section>
  );
}

/** The spread as columns, drawn on Fluent's tokens so both themes stay legible; its numbers are in the table view. */
function Histogram({ bins }: { bins: ReturnType<typeof histogram> }) {
  const styles = useStyles();
  const [width, setWidth] = useState(480);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const band = innerW / Math.max(1, bins.length);
  const barW = Math.max(4, Math.min(32, band * 0.62));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const summary = bins.map((b) => `${b.label}: ${String(b.count)}`).join(', ');
  return (
    <div ref={measure} className={styles.plot}>
      <svg
        className={styles.svg}
        width={width}
        height={H}
        role="img"
        aria-label={`Posts by how many times they were seen. ${summary}`}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? styles.axis : styles.gridLine}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className={styles.tick}>
              {fmtCompact(Math.round(t))}
            </text>
          </g>
        ))}
        {bins.map((b, i) => {
          const center = PAD.left + band * i + band / 2;
          const top = y(b.count);
          return (
            <g key={b.label} data-bin={b.label}>
              <rect
                x={center - barW / 2}
                y={top}
                width={barW}
                height={Math.max(0, PAD.top + innerH - top)}
                rx={3}
                className={styles.bar}
              />
              <text x={center} y={H - 8} textAnchor="middle" className={styles.tick}>
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
