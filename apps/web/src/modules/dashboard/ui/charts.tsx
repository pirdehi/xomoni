'use client';
// The dashboard's charts (#252), drawn as SVG on Fluent UI's tokens (ADR-0019), so they follow the light and dark
// themes. One series each: the title names it, so there is no legend. A crosshair and tooltip on the line, a tooltip on
// each column, the same by keyboard, and every value in a table view too.
import { Button, makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { Table16Regular, DataLine16Regular } from '@fluentui/react-icons';
import { type KeyboardEvent, type PointerEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SeriesPoint } from '../domain/insights';

const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

const useStyles = makeStyles({
  wrap: { position: 'relative', width: '100%' },
  svg: { display: 'block', width: '100%', overflow: 'visible', outlineStyle: 'none' },
  focusable: {
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`, outlineOffset: '2px' },
  },
  grid: { stroke: tokens.colorNeutralStroke2, strokeWidth: 1 },
  tick: { fill: tokens.colorNeutralForeground3, fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
  line: {
    fill: 'none',
    stroke: tokens.colorBrandStroke1,
    strokeWidth: 2,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  },
  area: { fill: tokens.colorBrandStroke1, fillOpacity: 0.1 },
  dot: { fill: tokens.colorBrandStroke1, stroke: tokens.colorNeutralBackground1, strokeWidth: 2 },
  crosshair: { stroke: tokens.colorNeutralStroke1, strokeWidth: 1 },
  column: { fill: tokens.colorBrandStroke1 },
  columnActive: { fill: tokens.colorBrandForeground2 },
  // Gains and losses (#253): a diverging pair, never status colors. These two tokens pass the palette checks (lightness
  // band, CVD and normal-vision separation, contrast) against the page in both themes; direction carries it too.
  columnGain: { fill: tokens.colorBrandBackgroundHover },
  columnLoss: { fill: tokens.colorPaletteDarkOrangeBackground3 },
  columnSignedActive: { opacity: 0.75 },
  zero: { stroke: tokens.colorNeutralStroke1, strokeWidth: 1 },
  tooltip: {
    position: 'absolute',
    top: 0,
    pointerEvents: 'none',
    transform: 'translateX(-50%)',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow8,
    whiteSpace: 'nowrap',
    display: 'flex',
    flexDirection: 'column',
  },
  tipValue: { ...typographyStyles.body1Strong, color: tokens.colorNeutralForeground1 },
  tipLabel: { ...typographyStyles.caption1, color: tokens.colorNeutralForeground3 },
  toggle: { alignSelf: 'flex-start' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    ...typographyStyles.body1,
    '& th, & td': {
      textAlign: 'left',
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    '& td:last-child, & th:last-child': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  },
  tableBox: { maxHeight: '240px', overflowY: 'auto' },
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  hidden: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
});

/** Formats a count: in full under 10,000, compact above (12.9K). */
export function formatCount(n: number): string {
  return Math.abs(n) < 10_000
    ? Math.round(n).toLocaleString('en-US')
    : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** A day (`YYYY-MM-DD`) as "Nov 20", or "Nov 20, 2025" outside the current year of `today`. */
export function formatDay(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(!sameYear && { year: 'numeric' }),
  });
}

/** Round ticks covering `min` to `max`: three or four steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    if (min === 0) return [0, 1];
    // One value: a round step either side of it, a tenth of its size (at least 1).
    const pad = Math.max(1, 10 ** (Math.floor(Math.log10(Math.abs(min))) - 1));
    return niceTicks(min - pad, max + pad);
  }
  const raw = (max - min) / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = first; t < max + step; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}

/** The chart's width, following its container; a sensible width on the server and before layout. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The table that carries every value of a chart, for screen readers and for reading exact numbers. */
function ValuesTable({ points, label, today }: { points: readonly SeriesPoint[]; label: string; today: string }) {
  const s = useStyles();
  const rows = points.filter((p) => p.value !== null);
  return (
    <div className={s.tableBox}>
      <table className={s.table}>
        <caption className={s.hidden}>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.day}>
              <td>{formatDay(p.day, today)}</td>
              <td>{formatCount(p.value ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A *Show as table* / *Show as chart* switch, and what it shows. */
function WithTable({
  label,
  points,
  today,
  children,
}: {
  label: string;
  points: readonly SeriesPoint[];
  today: string;
  children: React.ReactNode;
}) {
  const s = useStyles();
  const [table, setTable] = useState(false);
  return (
    <div className={s.stack}>
      {table ? <ValuesTable points={points} label={label} today={today} /> : children}
      <Button
        className={s.toggle}
        size="small"
        appearance="subtle"
        icon={table ? <DataLine16Regular /> : <Table16Regular />}
        aria-pressed={table}
        onClick={() => setTable(!table)}
      >
        {table ? 'Show as chart' : 'Show as table'}
      </Button>
    </div>
  );
}

/** Index of the point nearest an x position, among those with a value. */
function nearest(xs: readonly number[], points: readonly SeriesPoint[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (points[i]?.value === null) continue;
    if (best === null || Math.abs((xs[i] ?? 0) - x) < Math.abs((xs[best] ?? 0) - x)) best = i;
  }
  return best;
}

/** The index the arrow keys move to, skipping days without a value. */
function stepIndex(points: readonly SeriesPoint[], from: number | null, step: 1 | -1): number | null {
  const start = from ?? (step === 1 ? -1 : points.length);
  for (let i = start + step; i >= 0 && i < points.length; i += step) if (points[i]?.value !== null) return i;
  return from;
}

/**
 * A line over days, such as followers (#252): 2px, a light wash under it, gaps where a day has no value, the last
 * value marked, and a crosshair with the day and value on hover or with the arrow keys.
 */
export function LineChart({ points, label, today }: { points: readonly SeriesPoint[]; label: string; today: string }) {
  const s = useStyles();
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0] ?? 0;
  const hi = ticks.at(-1) ?? 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const xs = points.map((_, i) => x(i));

  // One path per run of days with values: a missing day breaks the line.
  const runs: string[] = [];
  const areas: string[] = [];
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 0) {
      runs.push(run.map(([px, py], j) => `${j === 0 ? 'M' : 'L'}${px},${py}`).join(' '));
      const base = PAD.top + innerH;
      areas.push(
        `M${run[0]?.[0]},${base} ` + run.map(([px, py]) => `L${px},${py}`).join(' ') + ` L${run.at(-1)?.[0]},${base} Z`,
      );
    }
    run = [];
  };
  points.forEach((p, i) => {
    if (p.value === null) flush();
    else run.push([x(i), y(p.value)]);
  });
  flush();

  const lastIndex = points.findLastIndex((p) => p.value !== null);
  const last = points[lastIndex];
  const shown = active !== null ? points[active] : undefined;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setActive(nearest(xs, points, ((e.clientX - box.left) / box.width) * width));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive(stepIndex(points, active, e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Escape') setActive(null);
  };

  return (
    <WithTable label={label} points={points} today={today}>
      <div ref={ref} className={s.wrap}>
        <svg
          className={mergeClasses(s.svg, s.focusable)}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          height={HEIGHT}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <title id={titleId}>
            {last?.value != null ? `${label}: ${formatCount(last.value)} on ${formatDay(last.day, today)}` : label}
          </title>
          {ticks.map((t) => (
            <g key={t}>
              <line className={s.grid} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className={s.tick} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                {formatCount(t)}
              </text>
            </g>
          ))}
          {points.length > 0 && (
            <>
              <text className={s.tick} x={x(0)} y={HEIGHT - 6} textAnchor="start">
                {formatDay(points[0]?.day ?? '', today)}
              </text>
              <text className={s.tick} x={x(points.length - 1)} y={HEIGHT - 6} textAnchor="end">
                {formatDay(points.at(-1)?.day ?? '', today)}
              </text>
            </>
          )}
          {areas.map((d) => (
            <path key={`a${d}`} className={s.area} d={d} />
          ))}
          {runs.map((d) => (
            <path key={`l${d}`} className={s.line} d={d} />
          ))}
          {shown?.value != null && active !== null && (
            <line className={s.crosshair} x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} />
          )}
          {last?.value != null && <circle className={s.dot} cx={x(lastIndex)} cy={y(last.value)} r={4} />}
          {shown?.value != null && active !== null && active !== lastIndex && (
            <circle className={s.dot} cx={x(active)} cy={y(shown.value)} r={4} />
          )}
        </svg>
        {shown?.value != null && active !== null && (
          <div className={s.tooltip} style={{ left: `${(x(active) / width) * 100}%` }} role="status">
            <span className={s.tipValue}>{formatCount(shown.value)}</span>
            <span className={s.tipLabel}>{formatDay(shown.day, today)}</span>
          </div>
        )}
      </div>
    </WithTable>
  );
}

/** Groups days into weeks (Monday first) when a chart would have more than `max` columns. */
export function columnsOf(points: readonly SeriesPoint[], max = 45): { points: SeriesPoint[]; weekly: boolean } {
  if (points.length <= max) return { points: [...points], weekly: false };
  const weeks: SeriesPoint[] = [];
  for (const p of points) {
    const date = new Date(`${p.day}T00:00:00Z`);
    const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const current = weeks.at(-1);
    if (current?.day === monday) {
      if (p.value !== null) current.value = (current.value ?? 0) + p.value;
    } else weeks.push({ day: monday, value: p.value });
  }
  return { points: weeks, weekly: true };
}

/**
 * Columns over days, or weeks for a long period, such as what was published (#252): at most 24px wide, a rounded top,
 * square at the baseline, and the day and value on hover or with the arrow keys. A day without numbers has no column.
 */
export function ColumnChart({
  points,
  label,
  today,
  signed = false,
}: {
  points: readonly SeriesPoint[];
  label: string;
  today: string;
  /** Gains and losses (#253): columns go up from zero, or down in the loss color, and values carry their sign. */
  signed?: boolean;
}) {
  const s = useStyles();
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const { points: cols, weekly } = columnsOf(points);
  const max = Math.max(0, ...cols.map((p) => p.value ?? 0));
  const min = Math.min(0, ...cols.map((p) => p.value ?? 0));
  const ticks = niceTicks(min, max || (min < 0 ? 0 : 1));
  const lo = Math.min(0, ticks[0] ?? 0);
  const hi = Math.max(ticks.at(-1) ?? 1, 0) || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(cols.length, 1);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  /** The y of a value; zero is the baseline columns grow from, up or down. */
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const base = y(0);
  const total = cols.reduce((sum, p) => sum + (p.value ?? 0), 0);
  const signedCount = (v: number) =>
    signed && v > 0 ? `+${formatCount(v)}` : v < 0 ? `−${formatCount(-v)}` : formatCount(v);
  const shown = active !== null ? cols[active] : undefined;
  const unit = weekly ? 'Week of ' : '';

  /** A column with a 4px rounded end (less when it is short), square at the baseline; a loss hangs below it. */
  const column = (i: number, v: number) => {
    const left = cx(i) - barW / 2;
    const end = y(v);
    const r = Math.min(4, barW / 2, Math.abs(base - end));
    const dir = v >= 0 ? 1 : -1;
    return `M${left},${base} L${left},${end + dir * r} Q${left},${end} ${left + r},${end} L${left + barW - r},${end} Q${left + barW},${end} ${left + barW},${end + dir * r} L${left + barW},${base} Z`;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const i = Math.floor((px - PAD.left) / slot);
    setActive(i >= 0 && i < cols.length && cols[i]?.value !== null ? i : null);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive(stepIndex(cols, active, e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Escape') setActive(null);
  };

  return (
    <WithTable label={label} points={cols} today={today}>
      <div ref={ref} className={s.wrap}>
        <svg
          className={mergeClasses(s.svg, s.focusable)}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          height={HEIGHT}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <title id={titleId}>{`${label}: ${signedCount(total)} in all`}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line
                className={t === 0 && lo < 0 ? s.zero : s.grid}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text className={s.tick} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                {t < 0 ? `−${formatCount(-t)}` : formatCount(t)}
              </text>
            </g>
          ))}
          {cols.length > 0 && (
            <>
              <text className={s.tick} x={cx(0)} y={HEIGHT - 6} textAnchor="start">
                {formatDay(cols[0]?.day ?? '', today)}
              </text>
              <text className={s.tick} x={cx(cols.length - 1)} y={HEIGHT - 6} textAnchor="end">
                {formatDay(cols.at(-1)?.day ?? '', today)}
              </text>
            </>
          )}
          {cols.map((p, i) =>
            p.value ? (
              <path
                key={p.day}
                className={mergeClasses(
                  signed ? (p.value < 0 ? s.columnLoss : s.columnGain) : s.column,
                  active === i && (signed ? s.columnSignedActive : s.columnActive),
                )}
                d={column(i, p.value)}
              />
            ) : null,
          )}
        </svg>
        {shown && active !== null && (
          <div className={s.tooltip} style={{ left: `${(cx(active) / width) * 100}%` }} role="status">
            <span className={s.tipValue}>{signedCount(shown.value ?? 0)}</span>
            <span className={s.tipLabel}>
              {unit}
              {formatDay(shown.day, today)}
            </span>
          </div>
        )}
      </div>
    </WithTable>
  );
}
