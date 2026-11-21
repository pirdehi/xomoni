'use client';
// The install guide at `/install` (#44) on Fluent UI (ADR-0019): the way to install for the visitor's browser, where
// they stand (at the top and live), then the install questions (#306). Once a store lists Xomoni for this browser
// (#304), that is one button (*Add to Chrome*, *Get it for Edge*), and the zip's download and steps move under
// *Advanced: install from a zip*. Without a listing it is the download and the steps, told for the browser and computer,
// one at a time (#299). On a phone it says Xomoni runs on a computer, and offers nothing to install.
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  FolderZip20Regular,
  Globe16Regular,
  Open20Regular,
  ShieldCheckmark16Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useEffect, useState } from 'react';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';
import { ButtonLink } from '@/shared/ui/links';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';
import { useExtensionLink } from '@/modules/extension/ui/extension-session-sync';
import { GettingStarted } from '@/modules/extension/ui/getting-started';
import { ZIP_INSTALL_ID, installOffer } from '../domain/store-install';
import { type InstallSteps, InstallGuide, PhoneNotice, useInstallSteps, usePlatform } from './install-guide';
import { InstallHelp } from './install-help';
import { StoreAction, useStoreListings } from './store-install';

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
  zipNote: { marginTop: 0 },
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
  unsupported: { marginTop: tokens.spacingVerticalXXL },
  zip: {
    // Below the sticky site header (64 px), with some room, when a link leads here.
    scrollMarginTop: '80px',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  zipHeader: { '& button': { minHeight: '56px', paddingLeft: tokens.spacingHorizontalL } },
  zipTitle: { display: 'grid', rowGap: tokens.spacingVerticalXXS, textAlign: 'start' },
  zipLabel: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  zipHint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, fontWeight: 'normal' },
  zipPanel: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    margin: 0,
    padding: `0 ${tokens.spacingHorizontalL} ${tokens.spacingVerticalXL}`,
    [WIDE]: { padding: `0 ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalXXL}` },
  },
  zipText: {
    margin: 0,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },
  zipActions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
});

/**
 * The zip's download buttons and what to know about the file: the page's main action at the top without a store, or
 * a secondary one under *Advanced*, where the store's button stays the page's one primary action.
 */
function ZipDownload({ steps, inHero }: { steps: InstallSteps; inHero: boolean }) {
  const s = useStyles();
  const size = inHero ? 'large' : 'medium';
  return (
    <>
      <div className={inHero ? s.actions : s.zipActions}>
        <ButtonLink
          href={DOWNLOAD_URL}
          appearance={inHero ? 'primary' : 'secondary'}
          size={size}
          icon={<ArrowDownload20Regular />}
          onClick={steps.downloaded}
        >
          Download the latest version
        </ButtonLink>
        <ButtonLink href={RELEASES_URL} size={size} icon={<Open20Regular />}>
          All versions and checksums
        </ButtonLink>
      </div>
      <p className={mergeClasses(s.note, !inHero && s.zipNote)}>
        <ShieldCheckmark16Regular className={s.noteIcon} aria-hidden />
        Free and open source. Each release is built from a tagged commit by GitHub Actions, with a SHA-256 checksum.
      </p>
    </>
  );
}

/**
 * *Advanced: install from a zip*, closed at first, once a store lists Xomoni for this browser: the zip's download and
 * the whole guide (`children`), as before the stores. A link to `#install-from-a-zip` opens it and brings it into view,
 * on arrival or later, also where it appears only once the page knows the browser.
 */
function ZipInstall({ children }: { children: ReactNode }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const follow = () => {
      if (window.location.hash !== `#${ZIP_INSTALL_ID}`) return;
      setOpen(true);
      document.getElementById(ZIP_INSTALL_ID)?.scrollIntoView();
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return (
    <section id={ZIP_INSTALL_ID} className={s.zip} aria-label="Advanced: install from a zip">
      <Accordion collapsible openItems={open ? ['zip'] : []} onToggle={(_, data) => setOpen(data.openItems.length > 0)}>
        <AccordionItem value="zip">
          <AccordionHeader
            as="h2"
            size="large"
            expandIconPosition="end"
            icon={<FolderZip20Regular />}
            className={s.zipHeader}
          >
            <span className={s.zipTitle}>
              <span className={s.zipLabel}>Advanced: install from a zip</span>
              <span className={s.zipHint}>Needs Developer mode, and doesn’t update by itself.</span>
            </span>
          </AccordionHeader>
          <AccordionPanel className={s.zipPanel}>{children}</AccordionPanel>
        </AccordionItem>
      </Accordion>
    </section>
  );
}

/**
 * The install page at `/install`: header; the way to install for this browser (`installOffer`); *Where you are*, the
 * getting-started checklist, which looks for Xomoni every few seconds; the install questions, how to update among them
 * (#306); the footer.
 * - A store lists Xomoni for this browser (#304): its one button at the top, and the zip's download and steps folded
 *   under *Advanced: install from a zip* (`#install-from-a-zip`).
 * - No listing for this browser, as before the stores: the download buttons, and the steps for this browser and
 *   computer (the risks, download, unzip, add it to the browser, follow it here), which move on when the download
 *   starts and when Xomoni shows up.
 * - Firefox or Safari once a store lists Xomoni: that this browser can't run it, and the questions.
 * - A phone: why it can't be installed there instead of the download and the steps, then the questions.
 */
export function InstallPage() {
  const s = useStyles();
  const platform = usePlatform();
  const listings = useStoreListings();
  const offer = installOffer(platform, listings);
  const link = useExtensionLink();
  const steps = useInstallSteps(link.status === 'signed-in' || link.status === 'signed-out');
  const guide = <InstallGuide platform={platform} steps={steps} />;
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
              {offer.kind === 'store'
                ? 'Xomoni runs as an extension in your own browser, on your own computer. Adding it takes one click.'
                : 'Xomoni runs as an extension in your own browser, on your own computer. It takes a few minutes to set up.'}
            </p>
            {offer.kind === 'store' && <StoreAction offer={offer} />}
            {offer.kind === 'zip' && <ZipDownload steps={steps} inHero />}
            {offer.kind === 'unsupported' && (
              <MessageBar intent="warning" className={s.unsupported}>
                <MessageBarBody>
                  <MessageBarTitle>This browser can’t run Xomoni.</MessageBarTitle>
                  Open this page in Chrome, Edge or Brave on your computer to install it.
                </MessageBarBody>
              </MessageBar>
            )}
          </div>
        </section>
        <div className={mergeClasses(s.column, s.body)}>
          {offer.kind === 'phone' && <PhoneNotice />}
          {(offer.kind === 'store' || offer.kind === 'zip') && (
            <div className={mergeClasses(s.card, s.where)}>
              <GettingStarted
                next="/install"
                showDashboard
                live
                heading="Where you are"
                installHint={
                  offer.kind === 'store'
                    ? 'Add Xomoni with the button above. This ticks by itself when Xomoni first opens xomoni.com in this browser.'
                    : 'Follow the steps below. This ticks by itself when Xomoni first opens xomoni.com in this browser.'
                }
              />
            </div>
          )}
          {offer.kind === 'zip' && guide}
          {offer.kind === 'store' && (
            <ZipInstall>
              <p className={s.zipText}>For a browser the stores don’t serve, or to run a version from GitHub.</p>
              <ZipDownload steps={steps} inHero={false} />
              {guide}
            </ZipInstall>
          )}
          <InstallHelp platform={platform} listings={listings} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
