// Stacked columns of what is still on the account, by year, drawn with Fluent tokens (ADR-0019). Follows the
// dataviz spec: <=24px columns, 4px rounded data-ends, 2px surface gaps, hairline grid, legend + per-column
// tooltip, and a table view.
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { DataBarVertical20Regular } from '@fluentui/react-icons';
import { useCallback, useState } from 'react';
import type { ItemKind } from '../../shared/types';
import { fmtCompact, fmtNumber } from '../format';
import { useYearHistogram } from '../queries';
import { Card, EmptyState, Segmented } from './ui';

/** The categorical slot a series is drawn in; each slot is a Fluent token in both themes (see `useSeriesStyles`). */
type Slot = 's1' | 's2' | 's3';

interface Series {
  kind: ItemKind;
  label: string;
  slot: Slot;
}

const SERIES: Record<'activity' | 'likes', Series[]> = {
  activity: [
    { kind: 'post', label: 'Posts', slot: 's1' },
    { kind: 'reply', label: 'Replies', slot: 's2' },
    { kind: 'repost', label: 'Reposts', slot: 's3' },
  ],
  likes: [{ kind: 'like', label: 'Liked posts', slot: 's1' }],
};

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 40 };

const useStyles = makeStyles({
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: tokens.spacingHorizontalS,
  },
  loading: { height: `${H + 32}px` },
  tableWrap: { maxHeight: '16rem', overflowY: 'auto' },
  table: { fontVariantNumeric: 'tabular-nums' },
  head: { position: 'sticky', top: 0, zIndex: 1, backgroundColor: tokens.colorNeutralBackground1 },
  headCell: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  endAlign: { justifyContent: 'flex-end' },
  numeric: { textAlign: 'right', color: tokens.colorNeutralForeground1 },
  year: { color: tokens.colorNeutralForeground2 },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalSNudge },
  legendTotal: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums',
  },
  swatch: { width: '10px', height: '10px', flexShrink: 0, borderRadius: tokens.borderRadiusSmall },
  swatchSmall: { width: '8px', height: '8px' },
  plot: { position: 'relative' },
  svg: { display: 'block' },
  grid: { stroke: tokens.colorNeutralStroke2 },
  axis: { stroke: tokens.colorNeutralStroke1 },
  tick: {
    fill: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
    fontVariantNumeric: 'tabular-nums',
  },
  column: { transitionProperty: 'opacity', transitionDuration: tokens.durationFaster },
  tooltip: {
    position: 'absolute',
    top: 0,
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
    minWidth: '144px',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    pointerEvents: 'none',
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  tooltipYear: {
    marginBottom: tokens.spacingVerticalXXS,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  tooltipRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground2,
  },
  tooltipValue: { color: tokens.colorNeutralForeground1, fontVariantNumeric: 'tabular-nums' },
});

/**
 * The series colors: Xomoni's brand blue, then Fluent's pumpkin and magenta, each with its own step in light and
 * dark. Checked with the dataviz palette validator: every pair stays apart for protan and deutan readers (ΔE ≥ 9)
 * and each fill keeps 3:1 against the card. Status colors are left to states, never used for a series.
 */
const useSeriesStyles = makeStyles({
  s1: { fill: tokens.colorCompoundBrandBackground, backgroundColor: tokens.colorCompoundBrandBackground },
  s2: { fill: tokens.colorPalettePumpkinBorderActive, backgroundColor: tokens.colorPalettePumpkinBorderActive },
  s3: { fill: tokens.colorPaletteMagentaBorderActive, backgroundColor: tokens.colorPaletteMagentaBorderActive },
});

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => v / s <= 4) ?? 10 * pow;
  return Math.ceil(v / step) * step;
}

function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * Card with a per-year chart or table of the account's items still marked present in the inventory,
 * either posts, replies and reposts or likes. Years come from each item's `createdAt` (for likes,
 * the liked post's date, not the like time). The chart follows its container's width, and its colors
 * come from Fluent tokens, so both themes stay legible. Each column stacks its series bottom-up in legend
 * order; every mark and color swatch names its series in `data-series` (`post`, `reply`, `repost`, `like`).
 */
export function ActivityChart({ accountId }: { accountId: string }) {
  const styles = useStyles();
  const seriesStyles = useSeriesStyles();
  const [mode, setMode] = useState<'activity' | 'likes'>('activity');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const series = SERIES[mode];
  const data = useYearHistogram(
    accountId,
    series.map((s) => s.kind),
  );
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  // A callback ref: it measures the chart's container whenever one appears (after the data loads, or when the
  // view switches back to the chart) and stops when it goes away.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = series.map((s) => (data ?? []).reduce((sum, d) => sum + (d.values[s.kind] ?? 0), 0));
  const header = (
    <div className={styles.actions}>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'activity', label: 'Posts & replies' },
          { value: 'likes', label: 'Likes' },
        ]}
      />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'chart', label: 'Chart' },
          { value: 'table', label: 'Table' },
        ]}
      />
    </div>
  );

  return (
    <Card
      title="Still on your account, by year"
      subtitle={mode === 'likes' ? 'Grouped by when the liked post was published' : 'Grouped by publish date'}
      actions={header}
    >
      {data === undefined ? (
        <div className={styles.loading} />
      ) : !data.length ? (
        <EmptyState
          icon={<DataBarVertical20Regular />}
          title="No data yet"
          body="Import your X archive or complete your copy in the Library to see your history here."
        />
      ) : view === 'table' ? (
        <div className={styles.tableWrap}>
          <Table size="small" className={styles.table}>
            <TableHeader className={styles.head}>
              <TableRow>
                <TableHeaderCell className={styles.headCell}>Year</TableHeaderCell>
                {series.map((s) => (
                  <TableHeaderCell key={s.kind} className={styles.headCell} button={{ className: styles.endAlign }}>
                    {s.label}
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data].reverse().map((d) => (
                <TableRow key={d.year}>
                  <TableCell className={styles.year}>{d.year}</TableCell>
                  {series.map((s) => (
                    <TableCell key={s.kind} className={styles.numeric}>
                      {fmtNumber(d.values[s.kind] ?? 0)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <>
          {series.length > 1 && (
            <div className={styles.legend}>
              {series.map((s, i) => (
                <span key={s.kind} className={styles.legendItem}>
                  <span className={mergeClasses(styles.swatch, seriesStyles[s.slot])} data-series={s.kind} />
                  {s.label} <span className={styles.legendTotal}>{fmtCompact(totals[i] ?? 0)}</span>
                </span>
              ))}
            </div>
          )}
          <div ref={measure} className={styles.plot} onMouseLeave={() => setHover(null)}>
            <Plot data={data} series={series} width={width} hover={hover} onHover={setHover} />
          </div>
        </>
      )}
    </Card>
  );
}

function Plot({
  data,
  series,
  width,
  hover,
  onHover,
}: {
  data: { year: number; values: Record<string, number> }[];
  series: Series[];
  width: number;
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const styles = useStyles();
  const seriesStyles = useSeriesStyles();
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(1, ...data.map((d) => series.reduce((s, x) => s + (d.values[x.kind] ?? 0), 0))));
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const band = innerW / data.length;
  const barW = Math.max(4, Math.min(24, band * 0.62));
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 44)));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const hovered = hover != null ? data[hover] : null;
  const hoverX = hover != null ? PAD.left + band * hover + band / 2 : 0;

  return (
    <>
      <svg className={styles.svg} width={width} height={H} role="img" aria-label="Posts per year">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? styles.axis : styles.grid}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className={styles.tick}>
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const center = PAD.left + band * i + band / 2;
          let acc = 0;
          const segments = series.map((s) => ({ s, v: d.values[s.kind] ?? 0 })).filter((x) => x.v > 0);
          return (
            <g key={d.year} className={styles.column} opacity={hover == null || hover === i ? 1 : 0.55}>
              {segments.map(({ s, v }, j) => {
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const gap = j > 0 ? 2 : 0;
                const h = Math.max(0, y0 - y1 - gap);
                const top = j === segments.length - 1;
                return top ? (
                  <path
                    key={s.kind}
                    d={topRounded(center - barW / 2, y1, barW, h, 4)}
                    className={seriesStyles[s.slot]}
                    data-series={s.kind}
                  />
                ) : (
                  <rect
                    key={s.kind}
                    x={center - barW / 2}
                    y={y1 + gap}
                    width={barW}
                    height={h}
                    className={seriesStyles[s.slot]}
                    data-series={s.kind}
                  />
                );
              })}
              {i % labelEvery === 0 && (
                <text x={center} y={H - 8} textAnchor="middle" className={styles.tick}>
                  {d.year}
                </text>
              )}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => onHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className={styles.tooltip} style={{ left: Math.min(Math.max(0, hoverX + 14), width - 160) }}>
          <div className={styles.tooltipYear}>{hovered.year}</div>
          {series.map((s) => (
            <div key={s.kind} className={styles.tooltipRow}>
              <span className={styles.legendItem}>
                <span
                  className={mergeClasses(styles.swatch, styles.swatchSmall, seriesStyles[s.slot])}
                  data-series={s.kind}
                />
                {s.label}
              </span>
              <span className={styles.tooltipValue}>{fmtNumber(hovered.values[s.kind] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
