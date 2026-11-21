'use client';
// The install guide's illustrations (#299, task 1.7): short looping drawings of the browser, in SVG with CSS
// animation, for turning on Developer mode, dragging the folder in and pinning Xomoni. Drawn in code, not recorded, so
// they stay crisp, take the theme's colors (light or dark), weigh nothing and can be translated with the page. Each is
// labelled an illustration, says in words what it shows, and can be paused; with `prefers-reduced-motion` it is one
// still frame. They follow the visitor's browser and computer once the page knows them (`usePlatform`), and carry no
// browser's or platform's logo.
import { Badge, Button, makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { Pause16Regular, Play16Regular } from '@fluentui/react-icons';
import { type ReactNode, useId, useState, useSyncExternalStore } from 'react';
import type { InstallStepId, Platform } from '../domain/install-guide';
import {
  type InstallVisual,
  type PageLayout,
  type ToolbarControl,
  type WindowFrame,
  VISUAL_WORDS as W,
  installVisual,
  visualsOf,
} from '../domain/install-visuals';

const NO_MOTION = '@media (prefers-reduced-motion: reduce)';
/** One loop of every illustration. */
const LOOP = '6s';

// The keyframes. Every drawing's resting styles are its last frame, so with no animation (reduced motion) it shows
// the result: the switch on, the folder over the page, Xomoni pinned.

/** The changing part fades in at the start of a loop and out at its end, so the loop restarts without a jump. */
const curtain = { '0%': { opacity: 1 }, '6%': { opacity: 0 }, '93%': { opacity: 0 }, '100%': { opacity: 1 } };

/** The pointer comes in from (`x`, `y`) away, then rests where it clicks. */
const pointerFrom = (x: number, y: number) => ({
  '0%, 8%': { opacity: 0, transform: `translate(${x}px, ${y}px)` },
  '14%': { opacity: 1, transform: `translate(${x}px, ${y}px)` },
  '36%, 100%': { opacity: 1, transform: 'translate(0px, 0px)' },
});

/** A click's ring, from `at` percent of the loop. */
const rippleAt = (at: number) => ({
  [`0%, ${at}%`]: { opacity: 0, transform: 'scale(0.4)' },
  [`${at + 3}%`]: { opacity: 0.9, transform: 'scale(1)' },
  [`${at + 14}%, 100%`]: { opacity: 0, transform: 'scale(2)' },
});

const trackTurnsOn = {
  '0%, 39%': { fill: tokens.colorNeutralBackground1, stroke: tokens.colorNeutralStrokeAccessible },
  '45%, 100%': { fill: tokens.colorBrandBackground, stroke: tokens.colorBrandBackground },
};
const knobTurnsOn = {
  '0%, 39%': { transform: 'translateX(-13px)', fill: tokens.colorNeutralStrokeAccessible },
  '45%, 100%': { transform: 'translateX(0px)', fill: tokens.colorNeutralForegroundOnBrand },
};
const appears = {
  '0%, 45%': { opacity: 0, transform: 'translateY(-4px)' },
  '55%, 100%': { opacity: 1, transform: 'translateY(0px)' },
};
/** The folder comes in from below the window, as from the computer's own folders, and rests over the page. */
const dragged = {
  '0%, 8%': { opacity: 0, transform: 'translate(-70px, 70px)' },
  '14%, 20%': { opacity: 1, transform: 'translate(-70px, 70px)' },
  '58%, 100%': { opacity: 1, transform: 'translate(0px, 0px)' },
};
const dropZone = { '0%, 34%': { opacity: 0 }, '46%, 100%': { opacity: 1 } };
const toPuzzleThenPin = {
  '0%, 6%': { opacity: 0, transform: 'translate(-150px, 83px)' },
  '10%': { opacity: 1, transform: 'translate(-150px, 83px)' },
  '24%, 32%': { transform: 'translate(-37px, -48px)' },
  '50%, 100%': { opacity: 1, transform: 'translate(0px, 0px)' },
};
const menuOpens = {
  '0%, 26%': { opacity: 0, transform: 'translateY(-6px)' },
  '32%, 100%': { opacity: 1, transform: 'translateY(0px)' },
};
const markStrokeOn = {
  '0%, 54%': { stroke: tokens.colorNeutralForeground3 },
  '58%, 100%': { stroke: tokens.colorBrandForeground1 },
};
const markFillOn = {
  '0%, 54%': { fill: tokens.colorNeutralBackground1, stroke: tokens.colorNeutralForeground3 },
  '58%, 100%': { fill: tokens.colorBrandForeground1, stroke: tokens.colorBrandForeground1 },
};
const dotOn = {
  '0%, 54%': { fill: tokens.colorNeutralForeground3 },
  '58%, 100%': { fill: tokens.colorBrandForeground1 },
};
const popsIn = {
  '0%, 58%': { opacity: 0, transform: 'scale(0.4)' },
  '66%': { opacity: 1, transform: 'scale(1.15)' },
  '72%, 100%': { opacity: 1, transform: 'scale(1)' },
};

/** How every moving part runs: one loop, again and again, still for those who ask their system for less motion. */
const looping = {
  animationDuration: LOOP,
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
  [NO_MOTION]: { animationName: 'none' },
};
/** A part that scales from its own middle. */
const fromItsMiddle = { transformBox: 'fill-box', transformOrigin: 'center' } as const;

const useStyles = makeStyles({
  visuals: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    // Two side by side where there is room, else one under the other; a lone one keeps a column's width.
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    margin: `${tokens.spacingVerticalL} 0 0`,
  },
  figure: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, minWidth: 0, margin: 0 },
  drawing: { display: 'block', width: '100%', height: 'auto', fontFamily: tokens.fontFamilyBase },
  paused: { '& *': { animationPlayState: 'paused' } },
  footer: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalS },
  caption: { ...typographyStyles.caption1, flexGrow: 1, minWidth: 0, color: tokens.colorNeutralForeground2 },
  tag: { marginRight: tokens.spacingHorizontalXS, verticalAlign: 'text-bottom' },
  // Nothing moves under reduced motion, so there is nothing to pause; the page hides it before it knows, too.
  toggle: { flexShrink: 0, [NO_MOTION]: { display: 'none' } },

  // The drawing's parts, in the theme's colors.
  window: { fill: tokens.colorNeutralBackground1 },
  outline: { fill: 'none', stroke: tokens.colorNeutralStroke1, strokeWidth: 1 },
  strip: { fill: tokens.colorNeutralBackground3 },
  surface: { fill: tokens.colorNeutralBackground1 },
  page: { fill: tokens.colorNeutralBackground2 },
  line: { fill: 'none', stroke: tokens.colorNeutralStroke2, strokeWidth: 1 },
  field: { fill: tokens.colorNeutralBackground3 },
  dot: { fill: tokens.colorNeutralStroke1 },
  glyph: {
    fill: 'none',
    stroke: tokens.colorNeutralForeground3,
    strokeWidth: 1.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  softDot: { fill: tokens.colorNeutralForeground3 },
  tabLabel: { fill: tokens.colorNeutralForeground2, fontSize: '8.5px' },
  address: { fill: tokens.colorNeutralForeground2, fontSize: '8.5px' },
  heading: { fill: tokens.colorNeutralForeground1, fontSize: '11.5px', fontWeight: tokens.fontWeightSemibold },
  label: { fill: tokens.colorNeutralForeground2, fontSize: '9px' },
  strong: { fill: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  small: { fill: tokens.colorNeutralForeground2, fontSize: '8px' },
  navActive: { fill: tokens.colorBrandBackground2 },
  card: { fill: tokens.colorNeutralBackground1, stroke: tokens.colorNeutralStroke2, strokeWidth: 1 },
  placeholder: { fill: tokens.colorNeutralStroke2 },
  placeholderSoft: { fill: tokens.colorNeutralBackground3 },
  button: { fill: tokens.colorNeutralBackground1, stroke: tokens.colorNeutralStroke1, strokeWidth: 1 },
  buttonLabel: { fill: tokens.colorNeutralForeground1, fontSize: '8px' },
  buttonBrand: { fill: tokens.colorBrandBackground2, stroke: tokens.colorBrandStroke1, strokeWidth: 1 },
  buttonBrandLabel: { fill: tokens.colorBrandForeground1, fontSize: '8px', fontWeight: tokens.fontWeightSemibold },
  track: { fill: tokens.colorBrandBackground, stroke: tokens.colorBrandBackground, strokeWidth: 1 },
  knob: { fill: tokens.colorNeutralForegroundOnBrand },
  pointer: { fill: tokens.colorNeutralForeground1, stroke: tokens.colorNeutralBackground1, strokeLinejoin: 'round' },
  ripple: { fill: 'none', stroke: tokens.colorBrandStroke1, strokeWidth: 1.5, opacity: 0, ...fromItsMiddle },
  dropZone: {
    fill: tokens.colorBrandBackground2,
    fillOpacity: 0.9,
    stroke: tokens.colorBrandStroke1,
    strokeWidth: 1.2,
    strokeDasharray: '5 3',
  },
  dropLabel: { fill: tokens.colorBrandForeground1, fontSize: '10px', fontWeight: tokens.fontWeightSemibold },
  folder: { fill: tokens.colorPaletteMarigoldBackground3, stroke: tokens.colorPaletteMarigoldBorderActive },
  folderTag: { fill: tokens.colorNeutralBackground1, stroke: tokens.colorNeutralStroke2, strokeWidth: 1 },
  folderLabel: { fill: tokens.colorNeutralForeground1, fontSize: '8px' },
  xomoni: { fill: tokens.colorBrandBackground },
  menu: { fill: tokens.colorNeutralBackground1, stroke: tokens.colorNeutralStroke2, strokeWidth: 1 },
  shadow: { fill: tokens.colorNeutralShadowKey },
  menuTitle: { fill: tokens.colorNeutralForeground1, fontSize: '9.5px', fontWeight: tokens.fontWeightSemibold },
  menuItem: { fill: tokens.colorNeutralForeground1, fontSize: '9px' },
  menuItemSoft: { fill: tokens.colorNeutralForeground3, fontSize: '9px' },
  markLine: { fill: 'none', stroke: tokens.colorBrandForeground1, strokeWidth: 1.1, strokeLinecap: 'round' },
  markShape: {
    fill: tokens.colorBrandForeground1,
    stroke: tokens.colorBrandForeground1,
    strokeWidth: 1.1,
    strokeLinejoin: 'round',
  },
  markDot: { fill: tokens.colorBrandForeground1 },
  markLineOff: { fill: 'none', stroke: tokens.colorNeutralForeground3, strokeWidth: 1.1, strokeLinecap: 'round' },
  markShapeOff: {
    fill: tokens.colorNeutralBackground1,
    stroke: tokens.colorNeutralForeground3,
    strokeWidth: 1.1,
    strokeLinejoin: 'round',
  },
  markDotOff: { fill: tokens.colorNeutralForeground3 },
  curtain: { fill: tokens.colorNeutralBackground2, opacity: 0 },

  // The moves.
  curtainMoves: { animationName: curtain, ...looping },
  pointerToTopRight: { animationName: pointerFrom(-105, 85), ...looping },
  pointerToLeftPanel: { animationName: pointerFrom(109, -46), ...looping },
  clickOnSwitch: { animationName: rippleAt(36), ...looping },
  trackMoves: { animationName: trackTurnsOn, ...looping },
  knobMoves: { animationName: knobTurnsOn, ...looping },
  appearsMoves: { animationName: appears, ...looping },
  draggedMoves: { animationName: dragged, ...looping },
  dropZoneMoves: { animationName: dropZone, ...looping },
  pointerToPin: { animationName: toPuzzleThenPin, ...looping },
  clickOnPuzzle: { animationName: rippleAt(24), ...looping },
  clickOnPin: { animationName: rippleAt(52), ...looping },
  menuMoves: { animationName: menuOpens, ...looping },
  markLineMoves: { animationName: markStrokeOn, ...looping },
  markShapeMoves: { animationName: markFillOn, ...looping },
  markDotMoves: { animationName: dotOn, ...looping },
  xomoniMoves: { animationName: popsIn, ...looping, ...fromItsMiddle },
});

/** The area under the window's toolbar, with the window's rounded bottom corners. */
const PAGE = 'M0.5 49 H319.5 V189.5 A10 10 0 0 1 309.5 199.5 H10.5 A10 10 0 0 1 0.5 189.5 Z';
/** Everything under the tab strip: what changes in the pinning drawing. */
const UNDER_TABS = 'M0.5 24.5 H319.5 V189.5 A10 10 0 0 1 309.5 199.5 H10.5 A10 10 0 0 1 0.5 189.5 Z';
const TAB_STRIP = 'M0.5 24.5 V10.5 A10 10 0 0 1 10.5 0.5 H309.5 A10 10 0 0 1 319.5 10.5 V24.5 Z';
const LEFT_PANEL = 'M0.5 49 H116 V199.5 H10.5 A10 10 0 0 1 0.5 189.5 Z';
/** A puzzle piece, about its middle: the browser's extensions button. */
const PUZZLE = 'M-5 -3 h2.5 a2 2 0 1 1 4 0 h2.5 v2.5 a2 2 0 1 1 0 4 v2.5 h-9 z';
/** An arrow pointer, its tip at 0,0. */
const POINTER = 'M0 0 V12.5 L3.2 9.6 L5.6 14.6 L7.6 13.7 L5.3 8.8 H9.4 Z';
/** A folder, about its middle. */
const FOLDER = 'M-14 -7 a2 2 0 0 1 2 -2 h7 l3 3 h14 a2 2 0 0 1 2 2 v13 a2 2 0 0 1 -2 2 h-24 a2 2 0 0 1 -2 -2 z';
const PIN_HEAD = 'M-2.5 -5 h5 l-0.8 3.5 l2.8 2.5 v1 h-9 v-1 l2.8 -2.5 z';
const PIN_NEEDLE = 'M0 2 v4.5';
const EYE = 'M-5.5 0 C-3.5 -3.6 3.5 -3.6 5.5 0 C3.5 3.6 -3.5 3.6 -5.5 0 Z';

/** A class that animates only while the drawing moves. */
function moving(live: boolean, still: string, moves: string): string {
  return live ? mergeClasses(still, moves) : still;
}

/**
 * The browser window around the page: the tab strip with the computer's window buttons, one tab, and the toolbar
 * with the address and the puzzle icon. `extra` goes in the toolbar, such as a pinned extension.
 */
function BrowserWindow({
  frame,
  tab,
  address,
  addressWidth = 196,
  extra,
}: {
  frame: WindowFrame;
  tab: string;
  address: string;
  addressWidth?: number;
  extra?: ReactNode;
}) {
  const s = useStyles();
  const tabX = frame === 'mac' ? 46 : 10;
  return (
    <>
      <rect className={s.window} x="0.5" y="0.5" width="319" height="199" rx="10" />
      <path className={s.strip} d={TAB_STRIP} />
      {frame === 'mac' && [14, 25, 36].map((cx) => <circle key={cx} className={s.dot} cx={cx} cy="12.5" r="3.5" />)}
      {frame === 'windows' && (
        <g className={s.glyph} data-part="window-buttons">
          <path d="M266 12.5 h8" />
          <rect x="284" y="8.5" width="8" height="8" rx="1" />
          <path d="M302 8.5 l8 8 M310 8.5 l-8 8" />
        </g>
      )}
      <rect className={s.surface} x={tabX} y="5" width="104" height="24" rx="5" />
      <text className={s.tabLabel} x={tabX + 10} y="18.5">
        {tab}
      </text>
      <rect className={s.surface} x="0.5" y="24.5" width="319" height="24" />
      <path className={s.line} d="M0.5 48.5 H319.5" />
      <path className={s.glyph} d="M16 32.5 l-4 4 l4 4 M26 32.5 l4 4 l-4 4" />
      <rect className={s.field} x="40" y="29.5" width={addressWidth} height="14" rx="7" />
      <text className={s.address} x="50" y="39.5">
        {address}
      </text>
      {extra}
      <path className={s.glyph} transform="translate(262 37)" d={PUZZLE} />
      <circle className={s.field} cx="284" cy="36.5" r="5" />
      {[32.5, 36.5, 40.5].map((cy) => (
        <circle key={cy} className={s.softDot} cx="302" cy={cy} r="1.1" />
      ))}
    </>
  );
}

/** A switch, on; turning on as the drawing moves. */
function Switch({ x, y, live }: { x: number; y: number; live: boolean }) {
  const s = useStyles();
  return (
    <g data-part="developer-mode-switch">
      <rect className={moving(live, s.track, s.trackMoves)} x={x} y={y} width="26" height="13" rx="6.5" />
      <circle className={moving(live, s.knob, s.knobMoves)} cx={x + 19.5} cy={y + 6.5} r="4" />
    </g>
  );
}

/** One of the extensions page's buttons. */
function PageButton({
  x,
  y,
  width,
  brand,
  children,
}: {
  x: number;
  y: number;
  width: number;
  brand?: boolean;
  children: string;
}) {
  const s = useStyles();
  return (
    <>
      <rect className={brand ? s.buttonBrand : s.button} x={x} y={y} width={width} height="13" rx="3" />
      <text className={brand ? s.buttonBrandLabel : s.buttonLabel} x={x + width / 2} y={y + 9.2} textAnchor="middle">
        {children}
      </text>
    </>
  );
}

/** Another extension's card, in placeholders. */
function Card({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const s = useStyles();
  return (
    <>
      <rect className={s.card} x={x} y={y} width={width} height={height} rx="6" />
      <rect className={s.placeholder} x={x + 10} y={y + 10} width="14" height="14" rx="3" />
      <rect className={s.placeholder} x={x + 32} y={y + 11} width={Math.round(width * 0.45)} height="5" rx="2.5" />
      <rect className={s.placeholderSoft} x={x + 32} y={y + 20} width={Math.round(width * 0.6)} height="4" rx="2" />
      <rect className={s.placeholderSoft} x={x + width - 26} y={y + height - 14} width="16" height="8" rx="4" />
    </>
  );
}

/**
 * The extensions page with *Developer mode* where this browser keeps it: at the top right (`top-bar`) or in the panel
 * on the left (`side-panel`, Edge). Developer mode is on and *Load unpacked* shows; `live`, they turn on and appear.
 */
function ExtensionsPage({ layout, live }: { layout: PageLayout; live: boolean }) {
  const s = useStyles();
  const reveal = live ? s.appearsMoves : undefined;
  if (layout === 'side-panel')
    return (
      <g data-part="extensions-page">
        <path className={s.page} d={PAGE} />
        <path className={s.surface} d={LEFT_PANEL} />
        <path className={s.line} d="M116.5 49 V199.5" />
        <text className={s.heading} x="12" y="67.5">
          {W.extensions}
        </text>
        <rect className={s.field} x="12" y="75" width="92" height="12" rx="6" />
        <rect className={s.navActive} x="6" y="93" width="104" height="16" rx="4" />
        <text className={mergeClasses(s.small, s.strong)} x="12" y="104">
          {W.installed}
        </text>
        <text className={s.small} x="12" y="123">
          {W.shortcuts}
        </text>
        <path className={s.line} d="M12 143.5 H104" />
        <text className={s.label} x="12" y="166">
          {W.developerMode}
        </text>
        <Switch x={84} y={156} live={live} />
        <rect className={s.placeholderSoft} x="12" y="180" width="60" height="4" rx="2" />
        <text className={s.heading} x="128" y="67.5">
          {W.installed}
        </text>
        <g className={reveal} data-part="developer-buttons">
          <PageButton x={128} y={76} width={72} brand>
            {W.loadUnpacked}
          </PageButton>
          <PageButton x={206} y={76} width={74}>
            {W.pack}
          </PageButton>
        </g>
        <Card x={128} y={100} width={180} height={42} />
        <Card x={128} y={150} width={180} height={42} />
      </g>
    );
  return (
    <g data-part="extensions-page">
      <path className={s.page} d={PAGE} />
      <rect className={s.surface} x="0.5" y="49" width="319" height="28" />
      <path className={s.line} d="M0.5 77.5 H319.5" />
      <text className={s.heading} x="12" y="67.5">
        {W.extensions}
      </text>
      <rect className={s.field} x="96" y="56" width="96" height="14" rx="7" />
      <g className={s.glyph}>
        <circle cx="105" cy="62.5" r="2.6" />
        <path d="M107 64.5 l2.5 2.5" />
      </g>
      <text className={s.label} x="262" y="66.5" textAnchor="end">
        {W.developerMode}
      </text>
      <Switch x={268} y={57} live={live} />
      <g className={reveal} data-part="developer-buttons">
        <rect className={s.surface} x="0.5" y="78" width="319" height="22" />
        <path className={s.line} d="M0.5 100.5 H319.5" />
        <PageButton x={12} y={82.5} width={72} brand>
          {W.loadUnpacked}
        </PageButton>
        <PageButton x={90} y={82.5} width={74}>
          {W.pack}
        </PageButton>
        <PageButton x={170} y={82.5} width={42}>
          {W.update}
        </PageButton>
      </g>
      <Card x={12} y={110} width={142} height={52} />
      <Card x={166} y={110} width={142} height={52} />
    </g>
  );
}

/** The pointer, its tip at (`x`, `y`), moving there with `moves`; a click's ring under it with `click`. */
function Pointer({ x, y, moves, click }: { x: number; y: number; moves?: string; click?: string }) {
  const s = useStyles();
  return (
    <g transform={`translate(${x} ${y})`}>
      {click !== undefined && <circle className={mergeClasses(s.ripple, click)} r="7" />}
      <g className={moves}>
        <path className={s.pointer} d={POINTER} />
      </g>
    </g>
  );
}

/** Where the pointer turns on Developer mode, and where it comes from, for each layout. */
const SWITCH_AT: Record<PageLayout, { x: number; y: number }> = {
  'top-bar': { x: 285, y: 65 },
  'side-panel': { x: 101, y: 164 },
};

/** Turning on Developer mode: the pointer comes to the switch, clicks, the switch turns on and *Load unpacked* shows. */
function DeveloperModeDrawing({ visual, live }: { visual: InstallVisual; live: boolean }) {
  const s = useStyles();
  const at = SWITCH_AT[visual.layout];
  return (
    <>
      <BrowserWindow frame={visual.frame} tab={W.extensions} address={visual.address} />
      <ExtensionsPage layout={visual.layout} live={live} />
      <Pointer
        x={at.x}
        y={at.y}
        moves={live ? (visual.layout === 'top-bar' ? s.pointerToTopRight : s.pointerToLeftPanel) : undefined}
        click={live ? s.clickOnSwitch : undefined}
      />
      <path className={live ? mergeClasses(s.curtain, s.curtainMoves) : s.curtain} d={PAGE} />
    </>
  );
}

/** Where the folder is dropped, for each layout: over the cards, clear of where Developer mode is. */
const DROP: Record<
  PageLayout,
  { zone: { x: number; y: number; width: number; height: number }; at: { x: number; y: number } }
> = {
  'top-bar': { zone: { x: 6.5, y: 105, width: 307, height: 88 }, at: { x: 160, y: 158 } },
  'side-panel': { zone: { x: 122.5, y: 97, width: 191, height: 96 }, at: { x: 218, y: 156 } },
};

/**
 * Dragging the folder in: the page with Developer mode on, and the *xomoni-extension* folder dragged onto it. Chrome
 * and Brave say *Drop to install* while a folder is over the page; Edge's page is drawn with the drop area alone.
 */
function AddFolderDrawing({ visual, live }: { visual: InstallVisual; live: boolean }) {
  const s = useStyles();
  const { zone, at } = DROP[visual.layout];
  return (
    <>
      <BrowserWindow frame={visual.frame} tab={W.extensions} address={visual.address} />
      <ExtensionsPage layout={visual.layout} live={false} />
      <g className={live ? s.dropZoneMoves : undefined} data-part="drop-zone">
        <rect className={s.dropZone} x={zone.x} y={zone.y} width={zone.width} height={zone.height} rx="8" />
        {visual.layout === 'top-bar' && (
          <text className={s.dropLabel} x={zone.x + zone.width / 2} y={zone.y + 20} textAnchor="middle">
            {W.dropToInstall}
          </text>
        )}
      </g>
      <g transform={`translate(${at.x} ${at.y})`}>
        <g className={live ? s.draggedMoves : undefined} data-part="folder">
          <path className={s.folder} d={FOLDER} />
          <rect className={s.folderTag} x="-40" y="16" width="80" height="13" rx="6.5" />
          <text className={s.folderLabel} x="0" y="25.2" textAnchor="middle">
            {W.folder}
          </text>
          <path className={s.pointer} transform="translate(6 2)" d={POINTER} />
        </g>
      </g>
      <path className={live ? mergeClasses(s.curtain, s.curtainMoves) : s.curtain} d={PAGE} />
    </>
  );
}

/** The mark that keeps an extension in the toolbar: a pin, or Edge's eye; on (in the brand's color) or off. */
function ToolbarMark({ control, on, live }: { control: ToolbarControl; on: boolean; live: boolean }) {
  const s = useStyles();
  const line = on ? moving(live, s.markLine, s.markLineMoves) : s.markLineOff;
  const shape = on ? moving(live, s.markShape, s.markShapeMoves) : s.markShapeOff;
  const dot = on ? moving(live, s.markDot, s.markDotMoves) : s.markDotOff;
  return control === 'eye' ? (
    <>
      <path className={line} d={EYE} />
      <circle className={dot} r="1.7" />
    </>
  ) : (
    <>
      <path className={shape} d={PIN_HEAD} />
      <path className={line} d={PIN_NEEDLE} />
    </>
  );
}

/**
 * Pinning Xomoni: the pointer opens the puzzle icon's menu, then clicks the pin next to Xomoni (Edge's eye), and
 * Xomoni's button appears in the toolbar.
 */
function PinDrawing({ visual, live }: { visual: InstallVisual; live: boolean }) {
  const s = useStyles();
  return (
    <>
      <BrowserWindow
        frame={visual.frame}
        tab={W.welcomeTab}
        address={W.welcomePage}
        addressWidth={180}
        extra={
          <rect
            className={moving(live, s.xomoni, s.xomoniMoves)}
            data-part="pinned-xomoni"
            x="236"
            y="30.5"
            width="12"
            height="12"
            rx="3"
          />
        }
      />
      <path className={s.page} d={PAGE} />
      <rect className={s.placeholder} x="20" y="66" width="104" height="9" rx="4.5" />
      <rect className={s.placeholderSoft} x="20" y="84" width="118" height="5" rx="2.5" />
      <rect className={s.placeholderSoft} x="20" y="95" width="96" height="5" rx="2.5" />
      <Card x={20} y={112} width={122} height={66} />
      <g className={live ? s.menuMoves : undefined} data-part="extensions-menu">
        <rect className={s.shadow} x="153" y="53" width="160" height="96" rx="8" />
        <rect className={s.menu} x="152" y="50" width="160" height="96" rx="8" />
        <text className={s.menuTitle} x="164" y="67">
          {W.extensions}
        </text>
        <rect className={s.xomoni} x="164" y="76" width="12" height="12" rx="3" />
        <text className={s.menuItem} x="182" y="85.5">
          {W.xomoni}
        </text>
        <g transform="translate(296 82)" data-part="toolbar-mark">
          <ToolbarMark control={visual.control} on live={live} />
        </g>
        <rect className={s.placeholder} x="164" y="96" width="12" height="12" rx="3" />
        <text className={s.menuItemSoft} x="182" y="105.5">
          {W.otherExtension}
        </text>
        <g transform="translate(296 102)">
          <ToolbarMark control={visual.control} on={false} live={false} />
        </g>
        <path className={s.line} d="M152 118.5 H312" />
        <text className={s.small} x="164" y="134">
          {W.manage}
        </text>
      </g>
      {live && (
        <g transform="translate(263 38)">
          <circle className={mergeClasses(s.ripple, s.clickOnPuzzle)} r="7" />
        </g>
      )}
      {live && (
        <g transform="translate(296 82)">
          <circle className={mergeClasses(s.ripple, s.clickOnPin)} r="7" />
        </g>
      )}
      {/* Just past the mark, so the mark stays in sight once it is on. */}
      <Pointer x={300} y={87} moves={live ? s.pointerToPin : undefined} />
      <path className={live ? mergeClasses(s.curtain, s.curtainMoves) : s.curtain} d={UNDER_TABS} />
    </>
  );
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Whether the system asks for less motion, following its changes; `false` on the server and while hydrating, so the
 * page renders the same there and in the browser. The illustrations' CSS stops their motion before this knows.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(REDUCED_MOTION);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * One illustration in a figure: the drawing (hidden from screen readers), and under it the caption, which is its text
 * alternative and starts with *Illustration*, and *Pause* or *Play* (WCAG 2.2.2: it loops for longer than five
 * seconds). Under reduced motion it is a still frame without the button. `data-motion` says which: `playing`,
 * `paused` or `still`.
 */
export function InstallVisualFigure({ visual }: { visual: InstallVisual }) {
  const s = useStyles();
  const captionId = useId();
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const live = !reduced;
  const motion = reduced ? 'still' : paused ? 'paused' : 'playing';
  const Drawing =
    visual.id === 'developer-mode' ? DeveloperModeDrawing : visual.id === 'add-folder' ? AddFolderDrawing : PinDrawing;
  return (
    <figure
      className={s.figure}
      aria-labelledby={captionId}
      data-visual={visual.id}
      data-layout={visual.layout}
      data-frame={visual.frame}
      data-control={visual.control}
      data-motion={motion}
    >
      <svg className={mergeClasses(s.drawing, paused && s.paused)} viewBox="0 0 320 200" aria-hidden focusable="false">
        <Drawing visual={visual} live={live} />
        <rect className={s.outline} x="0.5" y="0.5" width="319" height="199" rx="10" />
      </svg>
      <div className={s.footer}>
        <figcaption id={captionId} className={s.caption}>
          <Badge className={s.tag} appearance="outline" color="informative" shape="rounded" size="small">
            Illustration
          </Badge>{' '}
          {visual.caption}
        </figcaption>
        {!reduced && (
          <Button
            className={s.toggle}
            size="small"
            appearance="subtle"
            icon={paused ? <Play16Regular /> : <Pause16Regular />}
            aria-label={`${paused ? 'Play' : 'Pause'} the illustration of ${visual.title}`}
            onClick={() => setPaused(!paused)}
          >
            {paused ? 'Play' : 'Pause'}
          </Button>
        )}
      </div>
    </figure>
  );
}

/**
 * The illustrations of one step (`visualsOf`), for this browser and computer, side by side where there is room.
 * Nothing for a step without any. Each is keyed by what it draws, so it starts over when the page learns the browser.
 */
export function InstallVisuals({ step, platform }: { step: InstallStepId; platform: Platform }) {
  const s = useStyles();
  const visuals = visualsOf(step).map((id) => installVisual(id, platform));
  if (visuals.length === 0) return null;
  return (
    <div className={s.visuals}>
      {visuals.map((visual) => (
        <InstallVisualFigure key={`${visual.id}-${visual.layout}-${visual.frame}-${visual.control}`} visual={visual} />
      ))}
    </div>
  );
}
