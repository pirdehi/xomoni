'use client';
// A figure's change against the period before (#252, #254), in words and with an arrow. On Fluent UI (ADR-0019).
import { makeStyles, tokens } from '@fluentui/react-components';
import { ArrowDown12Regular, ArrowUp12Regular } from '@fluentui/react-icons';
import { type Figure, change } from '../domain/insights';
import { formatCount } from './charts';

const useStyles = makeStyles({
  delta: { display: 'inline-flex', alignItems: 'center', columnGap: '2px' },
  up: { color: tokens.colorPaletteGreenForeground1 },
  down: { color: tokens.colorPaletteRedForeground1 },
});

/**
 * `+104 (+9%) vs the 30 days before`. The arrow is green or red only where `upIsGood` says which way is good;
 * otherwise it isn't judged. A percentage shows only where the period before had something (`unit: '%'` changes
 * in points). Over all time, or without a period before, it says so instead.
 */
export function Delta({
  figure,
  unit,
  upIsGood,
  period,
}: {
  figure: Figure;
  unit?: string;
  upIsGood?: boolean;
  /** The period's words without *Last* (`30 days`), or `all`. */
  period: string;
}) {
  const s = useStyles();
  const moved = change(figure);
  if (!moved) return <>{period === 'all' ? 'all time' : 'nothing to compare yet'}</>;
  const { change: diff, percent } = moved;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const amount = unit === '%' ? `${Math.abs(diff).toFixed(1)} pt` : formatCount(Math.abs(diff));
  const tone = diff === 0 || upIsGood === undefined ? undefined : diff > 0 === upIsGood ? s.up : s.down;
  return (
    <span className={s.delta}>
      {diff > 0 ? (
        <ArrowUp12Regular className={tone} aria-hidden />
      ) : diff < 0 ? (
        <ArrowDown12Regular className={tone} aria-hidden />
      ) : null}
      {sign}
      {amount}
      {percent !== null && unit !== '%' && ` (${sign}${Math.abs(percent).toFixed(0)}%)`} vs the {period} before
    </span>
  );
}
