'use client';

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Globe20Regular, PuzzlePiece20Regular } from '@fluentui/react-icons';

const flowing = {
  '0%': { left: '0%', opacity: 0 },
  '15%': { opacity: 1 },
  '85%': { opacity: 1 },
  '100%': { left: 'calc(100% - 6px)', opacity: 0 },
};
const marching = { from: { backgroundPositionX: '0px' }, to: { backgroundPositionX: '12px' } };
const breathing = { '0%, 100%': { opacity: 0.55 }, '50%': { opacity: 1 } };
const NO_MOTION = '@media (prefers-reduced-motion: reduce)';

const useStyles = makeStyles({
  link: {
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr) 40px',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    maxWidth: '320px',
  },
  node: {
    display: 'grid',
    placeItems: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusCircular,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorBrandForeground1,
    boxShadow: tokens.shadow4,
  },
  track: { position: 'relative', height: '2px' },
  waiting: {
    backgroundImage: `repeating-linear-gradient(90deg, ${tokens.colorBrandStroke1} 0 6px, transparent 6px 12px)`,
    animationName: [marching, breathing],
    animationDuration: '0.9s, 1.8s',
    animationTimingFunction: 'linear, ease-in-out',
    animationIterationCount: 'infinite',
    [NO_MOTION]: { animationName: 'none' },
  },
  connected: { backgroundColor: tokens.colorPaletteGreenBorder2 },
  dot: {
    position: 'absolute',
    top: '-2px',
    width: '6px',
    height: '6px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorPaletteGreenForeground1,
    boxShadow: `0 0 6px ${tokens.colorPaletteGreenForeground1}`,
    opacity: 0,
    animationName: flowing,
    animationDuration: '2.4s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    [NO_MOTION]: { animationName: 'none', opacity: 1, left: 'calc(50% - 3px)' },
  },
  second: { animationDelay: '0.8s', [NO_MOTION]: { display: 'none' } },
  third: { animationDelay: '1.6s', [NO_MOTION]: { display: 'none' } },
});

/**
 * The link between a browser's extension and this account, drawn as two nodes and a line: dashes march along it
 * while a code waits to be typed, and green dots flow once the browser is connected and reporting. Motion stops for
 * people who ask their system for less of it; the words next to it say the same.
 */
export function PairingLink({ state }: { state: 'waiting' | 'connected' }) {
  const s = useStyles();
  return (
    <div className={s.link} aria-hidden data-state={state}>
      <span className={s.node}>
        <PuzzlePiece20Regular />
      </span>
      <span className={mergeClasses(s.track, s[state])}>
        {state === 'connected' && (
          <>
            <span className={s.dot} />
            <span className={mergeClasses(s.dot, s.second)} />
            <span className={mergeClasses(s.dot, s.third)} />
          </>
        )}
      </span>
      <span className={s.node}>
        <Globe20Regular />
      </span>
    </div>
  );
}
