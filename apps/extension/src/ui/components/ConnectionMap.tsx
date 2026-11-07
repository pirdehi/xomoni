import { Caption1, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Globe20Regular } from '@fluentui/react-icons';
import type { WorkerStatus } from '../hooks';

/** Whether this browser is signed in to X, as the worker last saw; `unknown` while no X page is open. */
export type XLink = 'signed-in' | 'signed-out' | 'unknown';

/** Whether the worker's last look at X found this browser signed in; `unknown` while no X page has answered. */
export function xLinkOf({ info }: Pick<WorkerStatus, 'info'>): XLink {
  if (!info) return 'unknown';
  return info.loggedIn ? 'signed-in' : 'signed-out';
}

/** This browser's link to xomoni.com: reporting, waiting for the person (to confirm, or while connecting), or none. */
export type CloudLink = 'connected' | 'pending' | 'off';

/** How a line between two nodes looks: data flowing, a link being made, or none. */
type Flow = 'live' | 'pending' | 'off';

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
  // Nodes keep a fixed column, so the lines between them get the room; a label wider than its node overflows.
  map: {
    display: 'grid',
    gridTemplateColumns: '48px minmax(0, 1fr) 48px minmax(0, 1fr) 48px',
    alignItems: 'start',
    columnGap: tokens.spacingHorizontalXS,
    paddingInline: tokens.spacingHorizontalS,
  },
  mapLarge: { gridTemplateColumns: '64px minmax(0, 1fr) 64px minmax(0, 1fr) 64px' },
  node: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: tokens.spacingVerticalXS,
    minWidth: 0,
  },
  disc: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusCircular,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    transitionProperty: 'opacity, border-color',
    transitionDuration: tokens.durationNormal,
  },
  large: { width: '52px', height: '52px' },
  xDisc: {
    backgroundColor: tokens.colorNeutralForeground1,
    color: tokens.colorNeutralBackground1,
    fontSize: '20px',
    fontWeight: tokens.fontWeightBold,
    lineHeight: 1,
  },
  logo: { width: '26px', height: '26px', borderRadius: tokens.borderRadiusMedium },
  cloud: { color: tokens.colorBrandForeground1 },
  dim: {
    opacity: 0.5,
    borderTopStyle: 'dashed',
    borderRightStyle: 'dashed',
    borderBottomStyle: 'dashed',
    borderLeftStyle: 'dashed',
    boxShadow: 'none',
  },
  state: {
    position: 'absolute',
    right: '-1px',
    bottom: '-1px',
    width: '11px',
    height: '11px',
    borderRadius: tokens.borderRadiusCircular,
    border: `2px solid ${tokens.colorNeutralBackground1}`,
  },
  good: { backgroundColor: tokens.colorPaletteGreenBackground3 },
  warn: { backgroundColor: tokens.colorPaletteMarigoldBackground3 },
  label: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap' },
  link: { display: 'flex', flexDirection: 'column', alignItems: 'center', rowGap: tokens.spacingVerticalXS },
  track: { position: 'relative', width: '100%', height: '2px', marginTop: '19px' },
  trackLarge: { marginTop: '25px' },
  live: { backgroundColor: tokens.colorBrandStroke2 },
  pending: {
    backgroundImage: `repeating-linear-gradient(90deg, ${tokens.colorBrandStroke1} 0 6px, transparent 6px 12px)`,
    animationName: [marching, breathing],
    animationDuration: '0.9s, 1.8s',
    animationTimingFunction: 'linear, ease-in-out',
    animationIterationCount: 'infinite',
    [NO_MOTION]: { animationName: 'none' },
  },
  off: {
    backgroundImage: `repeating-linear-gradient(90deg, ${tokens.colorNeutralStroke1} 0 4px, transparent 4px 9px)`,
  },
  dot: {
    position: 'absolute',
    top: '-2px',
    width: '6px',
    height: '6px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandForeground1,
    boxShadow: `0 0 6px ${tokens.colorBrandForeground1}`,
    opacity: 0,
    animationName: flowing,
    animationDuration: '2.4s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    [NO_MOTION]: { animationName: 'none', opacity: 1, left: 'calc(50% - 3px)' },
  },
  second: { animationDelay: '0.8s', [NO_MOTION]: { display: 'none' } },
  third: { animationDelay: '1.6s', [NO_MOTION]: { display: 'none' } },
  caption: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase100,
    textAlign: 'center',
  },
});

/** One line between two nodes, with what flows along it written underneath. */
function Link({ flow, caption, large }: { flow: Flow; caption: string; large: boolean }) {
  const s = useStyles();
  return (
    <div className={s.link}>
      <div className={mergeClasses(s.track, large && s.trackLarge, s[flow])} data-flow={flow}>
        {flow === 'live' && (
          <>
            <span className={s.dot} />
            <span className={mergeClasses(s.dot, s.second)} />
            <span className={mergeClasses(s.dot, s.third)} />
          </>
        )}
      </div>
      <Caption1 className={s.caption}>{caption}</Caption1>
    </div>
  );
}

/** What the map says, for people who can't see it. */
export function describeConnections(x: XLink, cloud: CloudLink): string {
  const xPart =
    x === 'signed-in'
      ? 'This browser is signed in to X; your posts are read and cleaned here and stay here.'
      : x === 'signed-out'
        ? 'This browser is signed out of X.'
        : 'Xomoni works with the X account this browser is signed in to.';
  const cloudPart =
    cloud === 'connected'
      ? 'It sends job status, and only that, to xomoni.com.'
      : cloud === 'pending'
        ? 'Its link to xomoni.com is waiting for you.'
        : 'It isn’t connected to xomoni.com.';
  return `${xPart} ${cloudPart}`;
}

/**
 * How this browser links X and xomoni.com, drawn as three nodes: X, Xomoni in this browser, and xomoni.com. Dots
 * flow along a live link, dashes march along one being made, and a missing link is a still dashed line to a faded
 * node. Each line says what crosses it: X's posts stay in the browser; only job status goes to xomoni.com
 * (ADR-0004). Motion stops for people who ask their system for less of it.
 */
export function ConnectionMap({
  x,
  cloud,
  size = 'compact',
}: {
  x: XLink;
  cloud: CloudLink;
  size?: 'compact' | 'large';
}) {
  const s = useStyles();
  const large = size === 'large';
  const disc = (...extra: (string | false)[]) => mergeClasses(s.disc, large && s.large, ...extra);
  const cloudCaption =
    cloud === 'connected' ? 'Status only' : cloud === 'pending' ? 'Waiting for you' : 'Not connected';
  return (
    <div
      className={mergeClasses(s.map, large && s.mapLarge)}
      role="img"
      aria-label={describeConnections(x, cloud)}
      data-x={x}
      data-cloud={cloud}
    >
      <div className={s.node}>
        <span className={disc(s.xDisc, x === 'signed-out' && s.dim)} aria-hidden>
          𝕏
          {x !== 'unknown' && <span className={mergeClasses(s.state, x === 'signed-in' ? s.good : s.warn)} />}
        </span>
        <Caption1 className={s.label}>X</Caption1>
      </div>
      <Link flow={x === 'signed-in' ? 'live' : 'off'} caption="Posts stay here" large={large} />
      <div className={s.node}>
        <span className={disc()} aria-hidden>
          <img src="icons/icon48.png" alt="" className={s.logo} />
        </span>
        <Caption1 className={s.label}>This browser</Caption1>
      </div>
      <Link flow={cloud === 'connected' ? 'live' : cloud} caption={cloudCaption} large={large} />
      <div className={s.node}>
        <span className={disc(s.cloud, cloud === 'off' && s.dim)} aria-hidden>
          <Globe20Regular />
          {cloud !== 'off' && <span className={mergeClasses(s.state, cloud === 'connected' ? s.good : s.warn)} />}
        </span>
        <Caption1 className={s.label}>xomoni.com</Caption1>
      </div>
    </div>
  );
}
