'use client';
// xomoni.com's landing page on Fluent UI (ADR-0019): the hero with the dashboard, why deleting is hard, how Xomoni
// works, its safety rules, the extension and the website, privacy, questions and a closing call to action.
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  makeStyles,
  mergeClasses,
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
  PuzzlePiece20Regular,
  ShieldCheckmark16Regular,
  ShieldCheckmark24Regular,
} from '@fluentui/react-icons';
import { getImageProps } from 'next/image';
import { type ReactNode, useId } from 'react';
import { GITHUB_URL, INSTALL_URL } from '@/shared/config/site';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import { GithubMark, SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';
import { ALWAYS, FAQ, type Feature, HERO_FACTS, LIMITS, NEVER, PROBLEMS, STAYS, STEPS, SYNCS } from './content';

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
    maxWidth: '640px',
    margin: `${tokens.spacingVerticalXL} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    textWrapStyle: 'pretty',
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
    maxWidth: '672px',
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
    maxWidth: '672px',
    margin: `${tokens.spacingVerticalL} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
  },
  sectionBody: { marginTop: '48px' },

  grid: { display: 'grid', gap: tokens.spacingHorizontalL, margin: 0, padding: 0, listStyleType: 'none' },
  two: { [TWO_COLUMNS]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
  three: { [TWO_COLUMNS]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } },
  card: {
    boxSizing: 'border-box',
    padding: tokens.spacingHorizontalXXL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
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
  stepNumber: {
    margin: 0,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontVariantNumeric: 'tabular-nums',
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
  stats: { marginTop: tokens.spacingVerticalL },
  statIcon: { color: tokens.colorNeutralForeground3, fontSize: '24px' },
  statValue: {
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero800,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
  },
  statLabel: { margin: `${tokens.spacingVerticalXS} 0 0`, color: tokens.colorNeutralForeground2 },
  aside: {
    margin: `${tokens.spacingVerticalXXL} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
  },

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
        <Problems />
        <HowItWorks />
        <Safety />
        <Anywhere />
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

function Tile({ icon: Icon, tone }: { icon: Feature['icon']; tone: 'brand' | 'danger' | 'success' }) {
  const s = useStyles();
  const toneClass = { brand: s.tileBrand, danger: s.tileDanger, success: s.tileSuccess }[tone];
  return (
    <span className={mergeClasses(s.tile, toneClass)} data-tone={tone} aria-hidden>
      <Icon />
    </span>
  );
}

const SHOT_ALT = 'The Xomoni dashboard: removal stats, a year-by-year chart, X’s rate limits and the running job.';

/**
 * The dashboard screenshot, light or dark to match the visitor's system. A <picture> lets the browser fetch only the
 * one it shows, so it can load eagerly as the page's largest image.
 */
function DashboardShot({ className }: { className: string }) {
  const common = { alt: SHOT_ALT, width: 1440, height: 1000, sizes: '(min-width: 1152px) 1104px, 100vw' };
  const dark = getImageProps({ ...common, src: '/screens/overview-dark.png' }).props.srcSet;
  const { props: light } = getImageProps({ ...common, src: '/screens/overview.png', loading: 'eager' });
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={dark} />
      <img {...light} alt={SHOT_ALT} fetchPriority="high" className={className} />
    </picture>
  );
}

function Hero() {
  const s = useStyles();
  return (
    <section className={s.hero}>
      <div className={mergeClasses(s.container, s.heroText)}>
        <Badge appearance="tint" color="brand" shape="circular" size="extra-large" icon={<ShieldCheckmark16Regular />}>
          Free · Open source · For your own account
        </Badge>
        <h1 className={s.title}>
          Clean up your X history <span className={s.titleAccent}>without handing over your password.</span>
        </h1>
        <p className={s.lead}>
          Xomoni deletes your old posts, replies, reposts and likes from inside your own browser, at a pace X accepts.
          No API keys. No password. Your X session never leaves your computer.
        </p>
        <div className={mergeClasses(s.actions, s.centered)}>
          <ButtonLink href={INSTALL_URL} appearance="primary" size="large" icon={<PuzzlePiece20Regular />}>
            Get the extension
          </ButtonLink>
          <ButtonLink href="/login" size="large">
            Sign in to your dashboard
          </ButtonLink>
        </div>
        <p className={s.note}>For Chrome, Edge and Brave on desktop. Chrome Web Store listing coming soon.</p>
        <ul className={s.facts} aria-label="At a glance">
          {HERO_FACTS.map((fact) => (
            <li key={fact} className={s.fact}>
              <CheckmarkCircle16Filled className={s.success} aria-hidden />
              {fact}
            </li>
          ))}
        </ul>
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

function FeatureCard({ feature, tone }: { feature: Feature; tone: 'brand' | 'danger' }) {
  const s = useStyles();
  return (
    <li className={s.card}>
      <Tile icon={feature.icon} tone={tone} />
      <h3 className={s.cardTitle}>{feature.title}</h3>
      <p className={s.cardText}>{feature.body}</p>
    </li>
  );
}

function Problems() {
  const s = useStyles();
  return (
    <Section
      eyebrow="Why it’s hard"
      title="Deleting years of posts on X is harder than it should be."
      intro="X has no “delete everything older than…” button, and every shortcut has a catch."
    >
      <ul className={mergeClasses(s.grid, s.three)}>
        {PROBLEMS.map((problem) => (
          <FeatureCard key={problem.title} feature={problem} tone="danger" />
        ))}
      </ul>
    </Section>
  );
}

function HowItWorks() {
  const s = useStyles();
  return (
    <Section
      id="how"
      eyebrow="How it works"
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
    </Section>
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
      eyebrow="Safety"
      title="Works with X’s protections, not against them."
      intro="Your account matters more than speed. When X pushes back, Xomoni listens and slows down or stops."
    >
      <div className={mergeClasses(s.grid, s.two)}>
        <RuleList title="Xomoni always" items={ALWAYS} kind="always" />
        <RuleList title="Xomoni never" items={NEVER} kind="never" />
      </div>
      <ul className={mergeClasses(s.grid, s.three, s.stats)} aria-label="Default pacing">
        {LIMITS.map(({ icon: Icon, value, label }) => (
          <li key={value} className={s.card}>
            <Icon className={s.statIcon} aria-hidden />
            <p className={s.statValue}>{value}</p>
            <p className={s.statLabel}>{label}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Anywhere() {
  const s = useStyles();
  return (
    <Section
      eyebrow="Extension + website"
      title="The work happens in your browser. The dashboard goes with you."
      intro="Create a free account on xomoni.com and connect your browser with a one-time code, then follow your cleanup from any device."
    >
      <div className={mergeClasses(s.grid, s.two)}>
        <div className={s.card}>
          <Tile icon={Laptop24Regular} tone="brand" />
          <div className={s.cardTitleRow}>
            <h3 className={mergeClasses(s.cardTitle, s.flush)}>In the extension</h3>
            <Badge appearance="tint" color="success" shape="rounded">
              Does the work
            </Badge>
          </div>
          <p className={s.cardText}>
            Plan a cleanup, preview it, back it up and start it. Deletions only ever run here, in the X tab on your
            computer, and only after you type DELETE.
          </p>
        </div>
        <div className={s.card}>
          <Tile icon={Phone24Regular} tone="brand" />
          <div className={s.cardTitleRow}>
            <h3 className={mergeClasses(s.cardTitle, s.flush)}>On xomoni.com</h3>
            <Badge appearance="tint" color="informative" shape="rounded">
              View only
            </Badge>
          </div>
          <p className={s.cardText}>
            See which browsers are connected and how each job is going, live, from your phone or any computer. The
            website can’t start a deletion, so a stolen login can’t wipe your account.
          </p>
        </div>
      </div>
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
          {FAQ.map(({ q, a }) => (
            <AccordionItem key={q} value={q} className={s.faqItem}>
              <AccordionHeader as="h3" size="large" expandIconPosition="end">
                {q}
              </AccordionHeader>
              <AccordionPanel>
                <p className={s.faqAnswer}>{a}</p>
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
            <ButtonLink href={INSTALL_URL} appearance="primary" size="large" icon={<PuzzlePiece20Regular />}>
              Get the extension
            </ButtonLink>
            <ButtonLink href={GITHUB_URL} size="large" icon={<GithubMark />}>
              Star on GitHub
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
