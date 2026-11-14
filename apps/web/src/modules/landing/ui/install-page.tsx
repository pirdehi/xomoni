'use client';
// The install guide at `/install` (#44) on Fluent UI (ADR-0019): download the latest release, load it unpacked, and
// optionally connect it to xomoni.com. Until the Chrome Web Store listing exists (#43), this is how to install.
import { Badge, makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  ArrowSync20Regular,
  Globe16Regular,
  Open20Regular,
  ShieldCheckmark16Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

const WIDE = '@media (min-width: 640px)';

const useStyles = makeStyles({
  column: {
    boxSizing: 'border-box',
    maxWidth: '832px',
    margin: '0 auto',
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
    [WIDE]: { paddingLeft: tokens.spacingHorizontalXXL, paddingRight: tokens.spacingHorizontalXXL },
  },
  hero: {
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundImage: `radial-gradient(60% 100% at 50% 0%, ${tokens.colorBrandBackground2} 0%, transparent 100%)`,
  },
  heroText: { paddingTop: '56px', paddingBottom: '48px', [WIDE]: { paddingTop: '80px', paddingBottom: '56px' } },
  title: {
    margin: `${tokens.spacingVerticalL} 0 0`,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightBold,
    lineHeight: '1.1',
    letterSpacing: '-0.03em',
    [WIDE]: { fontSize: tokens.fontSizeHero900 },
  },
  lead: {
    maxWidth: '640px',
    margin: `${tokens.spacingVerticalL} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM, marginTop: tokens.spacingVerticalXXL },
  note: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  noteIcon: { flexShrink: 0, marginTop: '2px', color: tokens.colorStatusSuccessForeground1 },
  body: { paddingTop: '48px', paddingBottom: '96px' },
  steps: { display: 'grid', gap: tokens.spacingVerticalL, margin: 0, padding: 0, listStyleType: 'none' },
  card: {
    boxSizing: 'border-box',
    padding: tokens.spacingHorizontalXXL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  step: { display: 'flex', gap: tokens.spacingHorizontalL },
  number: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
  },
  stepTitle: {
    ...typographyStyles.subtitle2,
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground1,
  },
  stepText: {
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
    '& code': {
      padding: `0 ${tokens.spacingHorizontalXS}`,
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorNeutralBackground2,
      color: tokens.colorNeutralForeground1,
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: '0.9em',
    },
    '& strong': { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  },
  update: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalXXL,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: 'none',
  },
  updateIcon: { flexShrink: 0, marginTop: '2px', color: tokens.colorBrandForeground1 },
  flushText: { margin: 0 },
});

/** One numbered step: the number is drawn, the ordered list already tells screen readers the position. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <li className={mergeClasses(s.card, s.step)}>
      <span className={s.number} aria-hidden>
        {n}
      </span>
      <div>
        <h2 className={s.stepTitle}>{title}</h2>
        <p className={s.stepText}>{children}</p>
      </div>
    </li>
  );
}

/**
 * The install page at `/install`: header, the download buttons, four steps (the risks, download and unzip, load it
 * unpacked, connect it here) and how to update, then the footer.
 */
export function InstallPage() {
  const s = useStyles();
  return (
    <>
      <SiteHeader />
      <main>
        <section className={s.hero}>
          <div className={mergeClasses(s.column, s.heroText)}>
            <Badge appearance="tint" color="brand" shape="circular" size="large" icon={<Globe16Regular />}>
              Chrome, Edge or Brave · version 116 or later
            </Badge>
            <h1 className={s.title}>Install Xomoni</h1>
            <p className={s.lead}>
              Xomoni runs as an extension in your own browser, on your own computer. It takes a few minutes to set up.
            </p>
            <div className={s.actions}>
              <ButtonLink href={DOWNLOAD_URL} appearance="primary" size="large" icon={<ArrowDownload20Regular />}>
                Download the latest version
              </ButtonLink>
              <ButtonLink href={RELEASES_URL} size="large" icon={<Open20Regular />}>
                All versions and checksums
              </ButtonLink>
            </div>
            <p className={s.note}>
              <ShieldCheckmark16Regular className={s.noteIcon} aria-hidden />
              Free and open source. Each release is built from a tagged commit by GitHub Actions, with a SHA-256
              checksum.
            </p>
          </div>
        </section>
        <div className={mergeClasses(s.column, s.body)}>
          <ol className={s.steps} aria-label="Install steps">
            <Step n={1} title="Read what can go wrong">
              Automating actions on X is against X’s rules, and an account can be limited. Read{' '}
              <TextLink href="/risks">the risks</TextLink> and download your X archive first.
            </Step>
            <Step n={2} title="Download and unzip">
              Download <code>xomoni-extension.zip</code> and unzip it into a folder you keep, such as Documents/Xomoni.
              Chrome loads the extension from that folder, so don’t delete it.
            </Step>
            <Step n={3} title="Load it in Chrome, Edge or Brave">
              Open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong> (top right), choose{' '}
              <strong>Load unpacked</strong> and select the unzipped folder. Pin Xomoni to the toolbar.
            </Step>
            <Step n={4} title="Follow it here (optional)">
              Sign in on xomoni.com, get a one-time code on your dashboard, and type it in the extension under{' '}
              <strong>Settings → xomoni.com</strong>. Only job status is sent; your posts and likes stay on your
              computer.
            </Step>
          </ol>
          <div className={mergeClasses(s.card, s.update)}>
            <ArrowSync20Regular className={s.updateIcon} aria-hidden />
            <p className={mergeClasses(s.stepText, s.flushText)}>
              <strong>Updating:</strong> download the new version, replace the folder’s contents and press the reload
              button on Xomoni’s card in <code>chrome://extensions</code>. Your data stays.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
