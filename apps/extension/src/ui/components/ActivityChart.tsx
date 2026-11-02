// Stacked columns of what is still on the account, by year. Follows the
// dataviz spec: <=24px columns, 4px rounded data-ends, 2px surface gaps,
// hairline grid, legend + per-column tooltip, and a table view.
import { ChartColumn } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ItemKind } from '../../shared/types';
import { fmtCompact, fmtNumber } from '../format';
import { useYearHistogram } from '../queries';
import { Card, EmptyState, Segmented } from './ui';

const SERIES: Record<'activity' | 'likes', { kind: ItemKind; label: string; color: string }[]> = {
  activity: [
    { kind: 'post', label: 'Posts', color: 'var(--s1)' },
    { kind: 'reply', label: 'Replies', color: 'var(--s2)' },
    { kind: 'repost', label: 'Reposts', color: 'var(--s3)' },
  ],
  likes: [{ kind: 'like', label: 'Liked posts', color: 'var(--s1)' }],
};

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 40 };

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
 * the liked post's date, not the like time).
 */
export function ActivityChart({ accountId }: { accountId: string }) {
  const [mode, setMode] = useState<'activity' | 'likes'>('activity');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const series = SERIES[mode];
  const data = useYearHistogram(
    accountId,
    series.map((s) => s.kind),
  );
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const totals = series.map((s) => (data ?? []).reduce((sum, d) => sum + (d.values[s.kind] ?? 0), 0));
  const header = (
    <div className="flex items-center gap-2">
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
        <div style={{ height: H + 32 }} />
      ) : !data.length ? (
        <EmptyState
          icon={<ChartColumn size={18} />}
          title="No data yet"
          body="Import your X archive or run a scan from the Inventory page to see your history here."
        />
      ) : view === 'table' ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="tabular w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
              <tr>
                <th className="py-1.5 font-medium">Year</th>
                {series.map((s) => (
                  <th key={s.kind} className="py-1.5 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.year} className="border-t border-line">
                  <td className="py-1.5 text-ink-2">{d.year}</td>
                  {series.map((s) => (
                    <td key={s.kind} className="py-1.5 text-right">
                      {fmtNumber(d.values[s.kind] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {series.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
              {series.map((s, i) => (
                <span key={s.kind} className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label} <span className="text-ink">{fmtCompact(totals[i] ?? 0)}</span>
                </span>
              ))}
            </div>
          )}
          <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
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
  series: { kind: ItemKind; label: string; color: string }[];
  width: number;
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
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
      <svg width={width} height={H} role="img" aria-label="Posts per year">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'}
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-muted text-[11px]">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + band * i + band / 2;
          let acc = 0;
          const segments = series.map((s) => ({ s, v: d.values[s.kind] ?? 0 })).filter((x) => x.v > 0);
          return (
            <g key={d.year} opacity={hover == null || hover === i ? 1 : 0.55}>
              {segments.map(({ s, v }, j) => {
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const gap = j > 0 ? 2 : 0;
                const h = Math.max(0, y0 - y1 - gap);
                const top = j === segments.length - 1;
                return top ? (
                  <path key={s.kind} d={topRounded(cx - barW / 2, y1, barW, h, 4)} fill={s.color} />
                ) : (
                  <rect key={s.kind} x={cx - barW / 2} y={y1 + gap} width={barW} height={h} fill={s.color} />
                );
              })}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="tabular fill-muted text-[11px]">
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
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(0, hoverX + 14), width - 160) }}
        >
          <div className="mb-1 font-medium text-ink">{hovered.year}</div>
          {series.map((s) => (
            <div key={s.kind} className="flex items-center justify-between gap-4 text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular text-ink">{fmtNumber(hovered.values[s.kind] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
