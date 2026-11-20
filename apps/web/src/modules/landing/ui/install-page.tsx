'use client';
// The install guide at `/install` (#44) on Fluent UI (ADR-0019): where the visitor stands, at the top and live; then the
// download and the steps, told for their browser and computer, one at a time (#299); then the install questions (#306).
// Until the Chrome Web Store listing exists (#43), this is how to install. On a phone it says Xomoni runs on a computer,
// and offers nothing to install.
import { Badge, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ArrowDownload20Regular, Globe16Regular, Open20Regular, ShieldCheckmark16Regular } from '@fluentui/react-icons';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';
import { ButtonLink } from '@/shared/ui/links';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';
import { useExtensionLink } from '@/modules/extension/ui/extension-session-sync';
import { GettingStarted } from '@/modules/extension/ui/getting-started';
import { InstallGuide, PhoneNotice, useInstallSteps, usePlatform } from './install-guide';
import { InstallHelp } from './install-help';

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
  body: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXL,
    paddingTop: '40px',
    paddingBottom: '96px',
  },
  card: {
    boxSizing: 'border-box',
    padding: tokens.spacingHorizontalL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    [WIDE]: { padding: tokens.spacingHorizontalXXL },
  },
  where: { borderTop: `${tokens.strokeWidthThickest} solid ${tokens.colorBrandStroke1}` },
});

/**
 * The install page at `/install`: header; the download buttons; *Where you are*, the getting-started checklist, which
 * looks for Xomoni every few seconds; the steps for this browser and computer (the risks, download, unzip, add it to
 * the browser, follow it here), which move on when the download starts and when Xomoni shows up; the install questions,
 * how to update among them (#306); the footer. On a phone, why it can't be installed there instead of the download and
 * the steps, then the questions.
 */
export function InstallPage() {
  const s = useStyles();
  const platform = usePlatform();
  const link = useExtensionLink();
  const steps = useInstallSteps(link.status === 'signed-in' || link.status === 'signed-out');
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
            {!platform.phone && (
              <>
                <div className={s.actions}>
                  <ButtonLink
                    href={DOWNLOAD_URL}
                    appearance="primary"
                    size="large"
                    icon={<ArrowDownload20Regular />}
                    onClick={steps.downloaded}
                  >
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
              </>
            )}
          </div>
        </section>
        <div className={mergeClasses(s.column, s.body)}>
          {platform.phone ? (
            <PhoneNotice />
          ) : (
            <>
              <div className={mergeClasses(s.card, s.where)}>
                <GettingStarted
                  next="/install"
                  showDashboard
                  live
                  heading="Where you are"
                  installHint="Follow the steps below. This ticks by itself when Xomoni first opens xomoni.com in this browser."
                />
              </div>
              <InstallGuide platform={platform} steps={steps} />
            </>
          )}
          <InstallHelp platform={platform} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
