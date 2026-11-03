import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';

const SIZE = 56;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const useStyles = makeStyles({
  root: { position: 'relative', width: `${SIZE}px`, height: `${SIZE}px`, flexShrink: 0 },
  svg: { display: 'block', transform: 'rotate(-90deg)' },
  track: { stroke: tokens.colorNeutralStroke2 },
  value: {
    stroke: tokens.colorBrandForeground1,
    transitionProperty: 'stroke-dashoffset',
    transitionDuration: tokens.durationSlow,
    transitionTimingFunction: tokens.curveEasyEase,
  },
  done: { stroke: tokens.colorStatusSuccessForeground1 },
  label: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums',
  },
});

/**
 * A round progress indicator with the percentage in its middle, for a job's share of settled items (ADR-0019).
 * Exposed as a `progressbar` with `aria-valuenow` (0–100, clamped) and the accessible name `label`; it turns green
 * at 100%.
 */
export function ProgressRing({ value, label }: { value: number; label: string }) {
  const styles = useStyles();
  const pct = Math.max(0, Math.min(100, value));
  const shown = pct > 0 && pct < 1 ? '<1' : String(Math.floor(pct));
  return (
    <div
      className={styles.root}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <svg className={styles.svg} width={SIZE} height={SIZE} viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}>
        <circle className={styles.track} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} />
        <circle
          className={mergeClasses(styles.value, pct >= 100 && styles.done)}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
        />
      </svg>
      <span className={styles.label} aria-hidden>
        {shown}%
      </span>
    </div>
  );
}
