'use client';
// xomoni.com's landing page on Fluent UI (ADR-0019), telling Xomoni as a digital footprint manager (#313): the hero
// with the dashboard and the one line about risk, the five things Xomoni does (with what each is on X today), the
// places (X today, email next, the rest later), how it works on X, its principles and safety rules, privacy,
// questions and a closing call to action. Both install buttons are `InstallButton` (#304): a link to /install today,
// the store's own button for the visitor's browser once a store lists Xomoni. On a phone or tablet, where Xomoni can't
// be installed, `InstallOrSend` puts *Send to my computer* in their place (#243).
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import {
  CheckmarkCircle16Filled,
  CheckmarkCircle20Filled,
  Cloud24Regular,
  DismissCircle20Filled,
  Laptop24Regular,
  LockClosed24Regular,
  Phone24Regular,
  Prohibited24Regular,
  ShieldCheckmark16Regular,
  ShieldCheckmark24Regular,
  Warning20Regular,
} from '@fluentui/react-icons';
import { getImageProps } from 'next/image';
import { type ReactNode, useId } from 'react';
import { GITHUB_URL } from '@/shared/config/site';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import { GithubMark, SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';
import { PILLARS, PILLAR_TEXT, PLACES, type Place, STATUS_LABEL, examplesOf, inStatusOrder } from '../domain/footprint';
import { listedStores, storeInSentence } from '../domain/store-install';
import {
  ALWAYS,
  FAQ,
  type Feature,
  HERO_FACTS,
  LIMITS,
  NEVER,
  PILLAR_ICONS,
  PRINCIPLES,
  RISK_LINE,
  STAYS,
  STEPS,
  SYNCS,
  placeIcon,
} from './content';
import { InstallOrSend } from './install-or-send';
import { InstallButton, useStoreListings } from './store-install';

const WIDE = '@media (min-width: 640px)';
const TWO_COLUMNS = '@media (min-width: 768px)';
const LARGE = '@media (min-width: 1024px)';

const useStyles = makeStyles({
  container: {
    boxSizing: 'border-box',
    maxWidth: '1152px',
    margin: '0 auto',
    // Sides only, so sections can set their own top and bottom padding at every width.
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
    [WIDE]: { paddingLeft: tokens.spacingHorizontalXXL, paddingRight: tokens.spacingHorizontalXXL },
  },

  hero: {
    overflow: 'hidden',
    backgroundImage: `radial-gradient(70% 50% at 50% 0%, ${tokens.colorBrandBackground2} 0%, transparent 100%)`,
  },
  heroText: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: '64px',
    paddingBottom: '56px',
    textAlign: 'center',
    [WIDE]: { paddingTop: '96px' },
  },
  title: {
    maxWidth: '920px',
    margin: `${tokens.spacingVerticalXXL} 0 0`,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightBold,
    lineHeight: '1.1',
    letterSpacing: '-0.03em',
    textWrapStyle: 'balance',
    [WIDE]: { fontSize: tokens.fontSizeHero900 },
    [LARGE]: { fontSize: tokens.fontSizeHero1000 },
  },
  titleAccent: { color: tokens.colorBrandForeground1 },
  lead: {
    maxWidth: '680px',
    margin: `${tokens.spacingVerticalXL} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    textWrapStyle: 'pretty',
    [WIDE]: { fontSize: tokens.fontSizeBase500, lineHeight: tokens.lineHeightBase500 },
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalXXXL,
  },
  centered: { justifyContent: 'center' },
  note: {
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  risk: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    boxSizing: 'border-box',
    maxWidth: '640px',
    margin: `${tokens.spacingVerticalXL} 0 0`,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    textAlign: 'start',
  },
  riskIcon: { flexShrink: 0, color: tokens.colorStatusWarningForeground1, fontSize: '20px' },
  riskText: { margin: 0 },
  facts: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXL}`,
    margin: `${tokens.spacingVerticalXXL} 0 0`,
    padding: 0,
    listStyleType: 'none',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
  },
  fact: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  success: { color: tokens.colorStatusSuccessForeground1, flexShrink: 0 },
  danger: { color: tokens.colorStatusDangerForeground1, flexShrink: 0 },
  shot: { paddingBottom: '80px' },
  frame: {
    overflow: 'hidden',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow64,
  },
  frameBar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    height: '36px',
    padding: `0 ${tokens.spacingHorizontalM}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  frameDot: {
    width: '10px',
    height: '10px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralStroke1,
  },
  frameTitle: {
    flexGrow: 1,
    // Balances the three dots on the left, so the title sits in the middle of the bar.
    marginRight: '46px',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textAlign: 'center',
  },
  shotImage: { display: 'block', width: '100%', height: 'auto' },

  section: {
    scrollMarginTop: '64px',
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  sectionInner: {
    paddingTop: '80px',
    paddingBottom: '80px',
    [WIDE]: { paddingTop: '96px', paddingBottom: '96px' },
  },
  eyebrow: {
    margin: 0,
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase300,
  },
  heading: {
    maxWidth: '760px',
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '1.2',
    letterSpacing: '-0.02em',
    textWrapStyle: 'balance',
    [WIDE]: { fontSize: tokens.fontSizeHero900 },
  },
  intro: {
    maxWidth: '680px',
    margin: `${tokens.spacingVerticalL} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
  },
  sectionBody: { marginTop: '48px' },

  grid: { display: 'grid', gap: tokens.spacingHorizontalL, margin: 0, padding: 0, listStyleType: 'none' },
  two: { [TWO_COLUMNS]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
  three: { [TWO_COLUMNS]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } },
  // Two columns on a tablet, three from 1024 px. The ranges don't overlap, so the order of the rules doesn't matter.
  twoThenThree: {
    '@media (min-width: 768px) and (max-width: 1023.98px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    [LARGE]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  },
  card: {
    boxSizing: 'border-box',
    padding: tokens.spacingHorizontalXXL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  compact: { padding: tokens.spacingHorizontalXL },
  step: { display: 'flex', gap: tokens.spacingHorizontalL },
  tile: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    borderRadius: tokens.borderRadiusXLarge,
    fontSize: '24px',
  },
  tileBrand: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 },
  tileDanger: { backgroundColor: tokens.colorStatusDangerBackground1, color: tokens.colorStatusDangerForeground1 },
  tileSuccess: { backgroundColor: tokens.colorStatusSuccessBackground1, color: tokens.colorStatusSuccessForeground1 },
  tileNeutral: { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground3 },
  cardTitle: {
    ...typographyStyles.subtitle2,
    margin: `${tokens.spacingVerticalL} 0 0`,
    color: tokens.colorNeutralForeground1,
  },
  cardTitleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalL,
  },
  flush: { margin: 0 },
  cardText: {
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },
  smallText: { fontSize: tokens.fontSizeBase300, lineHeight: '1.55' },
  stepNumber: {
    margin: 0,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontVariantNumeric: 'tabular-nums',
  },

  pillars: {
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    overflow: 'hidden',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  pillar: {
    display: 'grid',
    gridTemplateColumns: '44px minmax(0, 1fr)',
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalL,
    alignItems: 'start',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXL}`,
    ':not(:last-child)': { borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
    [WIDE]: { padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}` },
    [TWO_COLUMNS]: {
      gridTemplateColumns: '44px minmax(0, 2fr) minmax(0, 3fr)',
      columnGap: tokens.spacingHorizontalXXL,
    },
  },
  pillarName: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  pillarSummary: {
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.5',
  },
  // Under the name on a phone; its own column from 768 px.
  pillarToday: {
    display: 'grid',
    gap: tokens.spacingVerticalS,
    gridColumn: '2 / -1',
    [TWO_COLUMNS]: { gridColumn: 'auto' },
  },
  example: {
    margin: 0,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  exampleLabel: {
    display: 'block',
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase200,
  },
  exampleText: {
    display: 'block',
    marginTop: tokens.spacingVerticalXXS,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.55',
  },

  place: { display: 'flex', flexDirection: 'column' },
  // A planned place is drawn as an outline: it is on the way, not here.
  planned: {
    ...shorthands.borderStyle('dashed'),
    ...shorthands.borderColor(tokens.colorNeutralStroke1),
    backgroundColor: 'transparent',
    boxShadow: 'none',
  },
  placeHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacingHorizontalM },

  parts: { marginTop: '64px' },
  partsTitle: {
    ...typographyStyles.subtitle1,
    margin: 0,
    color: tokens.colorNeutralForeground1,
  },
  partsIntro: {
    maxWidth: '680px',
    margin: `${tokens.spacingVerticalS} 0 ${tokens.spacingVerticalXL}`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },

  listHeader: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM },
  list: {
    display: 'grid',
    gap: tokens.spacingVerticalM,
    margin: `${tokens.spacingVerticalXL} 0 0`,
    padding: 0,
    listStyleType: 'none',
  },
  listItem: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.5',
  },
  listIcon: { marginTop: '2px' },
  dot: {
    flexShrink: 0,
    width: '6px',
    height: '6px',
    marginTop: '9px',
    borderRadius: tokens.borderRadiusCircular,
  },
  dotSuccess: { backgroundColor: tokens.colorStatusSuccessForeground1 },
  dotNeutral: { backgroundColor: tokens.colorNeutralForeground3 },
  rules: { marginTop: tokens.spacingVerticalXXXL },
  // The default pace: three figures in one card, side by side from 768 px.
  pace: {
    display: 'grid',
    margin: `${tokens.spacingVerticalL} 0 0`,
    padding: 0,
    listStyleType: 'none',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    [TWO_COLUMNS]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  },
  paceItem: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL}`,
    ':not(:last-child)': {
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
      [TWO_COLUMNS]: {
        borderBottom: 'none',
        borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
      },
    },
  },
  paceIcon: { flexShrink: 0, marginTop: '4px', color: tokens.colorNeutralForeground3, fontSize: '24px' },
  paceValue: {
    margin: 0,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
  },
  paceLabel: {
    margin: `${tokens.spacingVerticalXXS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  aside: {
    maxWidth: '832px',
    margin: `${tokens.spacingVerticalXXL} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },
  asideSmall: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase300 },

  faq: { maxWidth: '832px', padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}` },
  faqItem: {
    ':not(:last-child)': { borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
  },
  faqAnswer: {
    margin: `0 0 ${tokens.spacingVerticalL}`,
    padding: `0 ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },
  faqMore: { marginTop: `-${tokens.spacingVerticalS}` },

  closing: { paddingBottom: '96px' },
  closingPanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: tokens.spacingVerticalXXL,
    padding: `40px ${tokens.spacingHorizontalXXL}`,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke2}`,
    borderRadius: tokens.borderRadius3XLarge,
    backgroundImage: `linear-gradient(135deg, ${tokens.colorBrandBackground2} 0%, ${tokens.colorNeutralBackground1} 100%)`,
    [TWO_COLUMNS]: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '48px',
    },
  },
  closingTitle: {
    margin: 0,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
    letterSpacing: '-0.02em',
    [WIDE]: { fontSize: tokens.fontSizeHero800, lineHeight: tokens.lineHeightHero800 },
  },
  closingText: {
    maxWidth: '560px',
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },
  closingActions: { flexShrink: 0, marginTop: 0 },
});

/** The landing page at `/`: everything between the site header and footer. */
export function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <WhatItDoes />
        <Places />
        <HowItWorks />
        <Safety />
        <Privacy />
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const s = useStyles();
  const headingId = useId();
  return (
    <section id={id} className={s.section} aria-labelledby={headingId}>
      <div className={mergeClasses(s.container, s.sectionInner)}>
        <p className={s.eyebrow}>{eyebrow}</p>
        <h2 id={headingId} className={s.heading}>
          {title}
        </h2>
        {intro && <p className={s.intro}>{intro}</p>}
        <div className={s.sectionBody}>{children}</div>
      </div>
    </section>
  );
}

type Tone = 'brand' | 'danger' | 'success' | 'neutral';

function Tile({ icon: Icon, tone }: { icon: Feature['icon']; tone: Tone }) {
  const s = useStyles();
  const toneClass = { brand: s.tileBrand, danger: s.tileDanger, success: s.tileSuccess, neutral: s.tileNeutral }[tone];
  return (
    <span className={mergeClasses(s.tile, toneClass)} data-tone={tone} aria-hidden>
      <Icon />
    </span>
  );
}

/**
 * Today's Home in the extension (#239), taken from `npm run preview:ui` at 1440 × 1000, light and dark. On a phone, the
 * same Home in a 700 × 900 window, its main column's top 460 × 580 at twice the pixels (#243): the whole page shrunk
 * to a phone's width can't be read. The words fit both.
 */
const SHOT_ALT =
  'Xomoni’s Home for an X account: a paused job to resume, and what is still on the account and what Xomoni removed.';

/** Up to this width (the page's own narrow layout), the screenshot is the narrow one, which reads on a phone. */
const NARROW_SHOT = '(max-width: 639px)';

/**
 * The dashboard screenshot, light or dark to match the visitor's system, and the narrow one on a phone. A <picture>
 * lets the browser fetch only the one it shows, so it can load eagerly as the page's largest image. Each <source> has
 * its own size, so the page keeps the right space for whichever is shown.
 */
function DashboardShot({ className }: { className: string }) {
  const common = { alt: SHOT_ALT, width: 1440, height: 1000, sizes: '(min-width: 1152px) 1104px, 100vw' };
  const narrow = { alt: SHOT_ALT, width: 920, height: 1160, sizes: '100vw' };
  const narrowDark = getImageProps({ ...narrow, src: '/screens/overview-narrow-dark.png' }).props.srcSet;
  const narrowLight = getImageProps({ ...narrow, src: '/screens/overview-narrow.png' }).props.srcSet;
  const dark = getImageProps({ ...common, src: '/screens/overview-dark.png' }).props.srcSet;
  const { props: light } = getImageProps({ ...common, src: '/screens/overview.png', loading: 'eager' });
  return (
    <picture>
      <source
        media={`${NARROW_SHOT} and (prefers-color-scheme: dark)`}
        srcSet={narrowDark}
        width={narrow.width}
        height={narrow.height}
      />
      <source media={NARROW_SHOT} srcSet={narrowLight} width={narrow.width} height={narrow.height} />
      <source media="(prefers-color-scheme: dark)" srcSet={dark} />
      <img {...light} alt={SHOT_ALT} fetchPriority="high" className={className} />
    </picture>
  );
}

/**
 * Where Xomoni comes from, under the hero's buttons: the stores that list it, or, until one does, that the Chrome Web
 * Store listing is coming.
 */
function useWhereFrom(): string {
  const stores = listedStores(useStoreListings()).map(storeInSentence);
  return stores.length === 0
    ? 'For Chrome, Edge and Brave on desktop. Chrome Web Store listing coming soon.'
    : `For Chrome, Edge and Brave on desktop, from ${stores.join(' or ')}.`;
}

function Hero() {
  const s = useStyles();
  const whereFrom = useWhereFrom();
  return (
    <section className={s.hero}>
      <div className={mergeClasses(s.container, s.heroText)}>
        <Badge appearance="tint" color="brand" shape="circular" size="extra-large" icon={<ShieldCheckmark16Regular />}>
          Digital footprint manager · Free and open source
        </Badge>
        <h1 className={s.title}>
          Manage your digital footprint, <span className={s.titleAccent}>starting with X.</span>
        </h1>
        <p className={s.lead}>
          Years of posts, replies and likes add up to a picture of you. Xomoni helps you find it, understand it and
          clean up what no longer speaks for you, from your own computer and only as you decide. It works on X today;
          your email is next.
        </p>
        <div className={mergeClasses(s.actions, s.centered)}>
          <InstallOrSend align="center">
            <InstallButton>Get the extension</InstallButton>
          </InstallOrSend>
          <ButtonLink href="/login" size="large">
            Sign in to your dashboard
          </ButtonLink>
        </div>
        <p className={s.note}>{whereFrom}</p>
        <ul className={s.facts} aria-label="At a glance">
          {HERO_FACTS.map((fact) => (
            <li key={fact} className={s.fact}>
              <CheckmarkCircle16Filled className={s.success} aria-hidden />
              {fact}
            </li>
          ))}
        </ul>
        <div className={s.risk} role="note" aria-label="The risk">
          <Warning20Regular className={s.riskIcon} aria-hidden />
          <p className={s.riskText}>
            {RISK_LINE} <TextLink href="/risks">Read the risks</TextLink>
          </p>
        </div>
      </div>
      <div className={mergeClasses(s.container, s.shot)}>
        <figure className={mergeClasses(s.frame, s.flush)}>
          <div className={s.frameBar} aria-hidden>
            <span className={s.frameDot} />
            <span className={s.frameDot} />
            <span className={s.frameDot} />
            <span className={s.frameTitle}>Xomoni dashboard</span>
          </div>
          <DashboardShot className={s.shotImage} />
        </figure>
      </div>
    </section>
  );
}

/** The five pillars as verbs. No-break spaces (`\u00a0`) keep each phrase whole, so it breaks only after a comma. */
const PILLARS_TITLE = 'Find\u00a0it, understand\u00a0it, clean\u00a0it\u00a0up, protect\u00a0it, shape\u00a0it.';

function WhatItDoes() {
  const s = useStyles();
  return (
    <Section
      id="what"
      eyebrow="What it does"
      title={PILLARS_TITLE}
      intro="Your digital footprint is what you have posted, liked and left online, what people see of you, and what you want them to see. Xomoni does the same five things in every place it covers. Here is what each one is on X today."
    >
      <ol className={s.pillars} aria-label="The five things Xomoni does">
        {PILLARS.map((pillar) => {
          const { name, summary } = PILLAR_TEXT[pillar];
          return (
            <li key={pillar} className={s.pillar}>
              <Tile icon={PILLAR_ICONS[pillar]} tone="brand" />
              <div>
                <h3 className={s.pillarName}>{name}</h3>
                <p className={s.pillarSummary}>{summary}</p>
              </div>
              <div className={s.pillarToday}>
                {examplesOf(pillar).map(({ place, text }) => (
                  <p key={place} className={s.example}>
                    <span className={s.exampleLabel}>On {place} today</span>{' '}
                    <span className={s.exampleText}>{text}</span>
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function PlaceCard({ place }: { place: Place }) {
  const s = useStyles();
  const today = place.status === 'today';
  const badge = {
    today: { appearance: 'filled', color: 'success' },
    next: { appearance: 'tint', color: 'brand' },
    later: { appearance: 'outline', color: 'informative' },
  } as const;
  return (
    <li className={mergeClasses(s.card, s.place, !today && s.planned)} data-status={place.status}>
      <div className={s.placeHead}>
        <Tile icon={placeIcon(place.id)} tone={today ? 'success' : 'neutral'} />
        <Badge shape="rounded" size="large" {...badge[place.status]}>
          {STATUS_LABEL[place.status]}
        </Badge>
      </div>
      <h3 className={s.cardTitle}>{place.name}</h3>
      <p className={s.cardText}>{place.summary}</p>
    </li>
  );
}

function Places() {
  const s = useStyles();
  return (
    <Section
      id="places"
      eyebrow="Where it works"
      title="X today. Your email next. Then everywhere you are."
      intro="Xomoni adds one place at a time, and only where it can keep the same principles. Nothing beyond X has a date yet."
    >
      <ol className={mergeClasses(s.grid, s.three)} aria-label="Places">
        {inStatusOrder(PLACES).map((place) => (
          <PlaceCard key={place.id} place={place} />
        ))}
      </ol>
      <p className={mergeClasses(s.aside, s.asideSmall)}>
        Xomoni is an independent project, not affiliated with, endorsed by or sponsored by X Corp.
      </p>
    </Section>
  );
}

function HowItWorks() {
  const s = useStyles();
  return (
    <Section
      id="how"
      eyebrow="How it works on X"
      title="A careful assistant in your browser, not a bot on a server."
      intro="Xomoni never sends its own requests to X. It works the way you do, just more patiently."
    >
      <ol className={mergeClasses(s.grid, s.two)}>
        {STEPS.map((step, i) => (
          <li key={step.title} className={mergeClasses(s.card, s.step)}>
            <Tile icon={step.icon} tone="brand" />
            <div>
              <p className={s.stepNumber}>Step {i + 1}</p>
              <h3 className={mergeClasses(s.cardTitle, s.flush)}>{step.title}</h3>
              <p className={s.cardText}>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <TwoParts />
    </Section>
  );
}

/** The extension and xomoni.com: which one does the work, and what the website may do (ADR-0006, ADR-0027). */
function TwoParts() {
  const s = useStyles();
  const headingId = useId();
  return (
    <div className={s.parts} role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className={s.partsTitle}>
        Two parts, one sign-in
      </h3>
      <p className={s.partsIntro}>
        Create a free account on xomoni.com and sign in once: Xomoni in the same browser signs in with you. The account
        is optional; the extension works without one.
      </p>
      <div className={mergeClasses(s.grid, s.two)}>
        <div className={mergeClasses(s.card, s.step)}>
          <Tile icon={Laptop24Regular} tone="brand" />
          <div>
            <div className={mergeClasses(s.cardTitleRow, s.flush)}>
              <h4 className={mergeClasses(s.cardTitle, s.flush)}>In the extension</h4>
              <Badge appearance="tint" color="success" shape="rounded">
                Does the work
              </Badge>
            </div>
            <p className={s.cardText}>
              Plan a cleanup, preview it, back it up and start it. Deletions only ever run here, in the X tab on your
              computer, and only after you type DELETE.
            </p>
          </div>
        </div>
        <div className={mergeClasses(s.card, s.step)}>
          <Tile icon={Phone24Regular} tone="brand" />
          <div>
            <div className={mergeClasses(s.cardTitleRow, s.flush)}>
              <h4 className={mergeClasses(s.cardTitle, s.flush)}>On xomoni.com</h4>
              <Badge appearance="tint" color="informative" shape="rounded">
                Shows and plans
              </Badge>
            </div>
            <p className={s.cardText}>
              See how your account is doing and follow each job live, from your phone or any computer. A cleanup planned
              here only fills in Xomoni’s Cleanup page, where you start it. The website can’t start a deletion or
              approve one, so a stolen login can’t wipe your account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleList({ title, items, kind }: { title: string; items: string[]; kind: 'always' | 'never' }) {
  const s = useStyles();
  const headingId = useId();
  const [Header, Item, tone] =
    kind === 'always'
      ? [ShieldCheckmark24Regular, CheckmarkCircle20Filled, 'success' as const]
      : [Prohibited24Regular, DismissCircle20Filled, 'danger' as const];
  return (
    <div className={s.card}>
      <div className={s.listHeader}>
        <Tile icon={Header} tone={tone} />
        <h3 id={headingId} className={mergeClasses(s.cardTitle, s.flush)}>
          {title}
        </h3>
      </div>
      <ul className={s.list} aria-labelledby={headingId}>
        {items.map((item) => (
          <li key={item} className={s.listItem}>
            <Item className={mergeClasses(s.listIcon, s[tone])} aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Safety() {
  const s = useStyles();
  return (
    <Section
      id="safety"
      eyebrow="Principles and safety"
      title="Under your oversight, within each platform’s limits."
      intro="These hold in every place Xomoni works, today and later. No feature and no speed is worth breaking them."
    >
      <ul className={mergeClasses(s.grid, s.twoThenThree)} aria-label="Principles">
        {PRINCIPLES.map((principle) => (
          <li key={principle.title} className={mergeClasses(s.card, s.compact, s.step)}>
            <Tile icon={principle.icon} tone="brand" />
            <div>
              <h3 className={mergeClasses(s.cardTitle, s.flush)}>{principle.title}</h3>
              <p className={mergeClasses(s.cardText, s.smallText)}>{principle.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className={mergeClasses(s.grid, s.two, s.rules)}>
        <RuleList title="On X, Xomoni always" items={ALWAYS} kind="always" />
        <RuleList title="On X, Xomoni never" items={NEVER} kind="never" />
      </div>
      <ul className={s.pace} aria-label="Default pace on X">
        {LIMITS.map(({ icon: Icon, value, label }) => (
          <li key={value} className={s.paceItem}>
            <Icon className={s.paceIcon} aria-hidden />
            <div>
              <p className={s.paceValue}>{value}</p>
              <p className={s.paceLabel}>{label}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className={s.aside}>
        Only X decides what happens to an account, so <TextLink href="/risks">read the risks</TextLink> before your
        first job.
      </p>
    </Section>
  );
}

function DataList({ title, items, kind }: { title: string; items: string[]; kind: 'stays' | 'syncs' }) {
  const s = useStyles();
  const headingId = useId();
  return (
    <div className={s.card}>
      <div className={s.listHeader}>
        <Tile
          icon={kind === 'stays' ? LockClosed24Regular : Cloud24Regular}
          tone={kind === 'stays' ? 'success' : 'brand'}
        />
        <h3 id={headingId} className={mergeClasses(s.cardTitle, s.flush)}>
          {title}
        </h3>
      </div>
      <ul className={s.list} aria-labelledby={headingId}>
        {items.map((item) => (
          <li key={item} className={s.listItem}>
            <span className={mergeClasses(s.dot, kind === 'stays' ? s.dotSuccess : s.dotNeutral)} aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Privacy() {
  const s = useStyles();
  return (
    <Section
      id="privacy"
      eyebrow="Privacy"
      title="Your posts never touch our servers."
      intro="An account is optional. The extension works fully offline without one; signing in only adds the remote dashboard."
    >
      <div className={mergeClasses(s.grid, s.two)}>
        <DataList title="Stays on your computer" items={STAYS} kind="stays" />
        <DataList title="Synced when you sign in" items={SYNCS} kind="syncs" />
      </div>
      <p className={s.aside}>
        Delete your account at any time from the dashboard; everything above goes with it. Read the{' '}
        <TextLink href="/privacy">privacy policy</TextLink>.
      </p>
    </Section>
  );
}

function Faq() {
  const s = useStyles();
  return (
    <Section eyebrow="FAQ" title="Questions people ask first.">
      <div className={mergeClasses(s.card, s.faq)}>
        <Accordion multiple collapsible>
          {FAQ.map(({ q, a, more }) => (
            <AccordionItem key={q} value={q} className={s.faqItem}>
              <AccordionHeader as="h3" size="large" expandIconPosition="end">
                {q}
              </AccordionHeader>
              <AccordionPanel>
                <p className={s.faqAnswer}>{a}</p>
                {more && (
                  <p className={mergeClasses(s.faqAnswer, s.faqMore)}>
                    <TextLink href={more.href}>{more.label}</TextLink>
                  </p>
                )}
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}

function ClosingCta() {
  const s = useStyles();
  const headingId = useId();
  return (
    <section className={s.closing} aria-labelledby={headingId}>
      <div className={s.container}>
        <div className={s.closingPanel}>
          <div>
            <h2 id={headingId} className={s.closingTitle}>
              Start with your archive.
            </h2>
            <p className={s.closingText}>
              Request it from X today (Settings → Your account → Download an archive of your data), or let Xomoni ask X
              for it once it is installed. It can take a day to arrive, and it is your backup before anything is
              deleted.
            </p>
          </div>
          <div className={mergeClasses(s.actions, s.closingActions)}>
            <InstallOrSend>
              <InstallButton>Get the extension</InstallButton>
            </InstallOrSend>
            <ButtonLink href={GITHUB_URL} size="large" icon={<GithubMark />}>
              Star on GitHub
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
