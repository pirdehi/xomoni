'use client';
// Installing from the browsers' stores (#304), on Fluent UI (ADR-0019): the store listings this page uses, the offer
// for the visitor's browser (`installOffer`), the store's button with what to know about it, and `InstallButton`, the
// one call to action other pages can use. With no listing, every piece here leads to the zip guide, as before.
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Info16Regular, PuzzlePiece20Regular, ShieldCheckmark16Regular, Warning16Regular } from '@fluentui/react-icons';
import { type ReactNode, useSyncExternalStore } from 'react';
import { INSTALL_URL } from '@/shared/config/site';
import { STORE_LISTINGS, type StoreListings, storeListings } from '@/shared/config/store-listings';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import { type InstallOffer, installOffer, storeInSentence } from '../domain/store-install';
import { usePlatform } from './install-guide';

const useStyles = makeStyles({
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM, marginTop: tokens.spacingVerticalXXL },
  notes: { display: 'grid', rowGap: tokens.spacingVerticalXS, marginTop: tokens.spacingVerticalM },
  note: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    '& strong': { color: tokens.colorNeutralForeground2, fontWeight: tokens.fontWeightSemibold },
  },
  noteIcon: { flexShrink: 0, marginTop: '2px' },
  safe: { color: tokens.colorStatusSuccessForeground1 },
  warn: { color: tokens.colorStatusWarningForeground1 },
});

const noSubscription = () => () => undefined;

/**
 * Where an end-to-end test puts the listings it wants (`{ chrome?: string, edge?: string }`) before the page loads.
 * Read only in a build made for those tests (`NEXT_PUBLIC_E2E_STORE_LISTINGS=1`, set by `playwright.config.ts`); in
 * any other build the check below is false at build time and the page never looks.
 */
const E2E_LISTINGS = '__xomoniE2EStoreListings';

let e2eSeen: unknown;
let e2eListings: StoreListings | null = null;

/** The test's listings, checked like the configured ones, or null when there are none (or this isn't a test build). */
function testListings(): StoreListings | null {
  if (process.env.NEXT_PUBLIC_E2E_STORE_LISTINGS !== '1') return null;
  const given = (window as unknown as Record<string, unknown>)[E2E_LISTINGS];
  if (given === e2eSeen) return e2eListings;
  e2eSeen = given;
  e2eListings = null;
  if (typeof given === 'object' && given !== null) {
    const { chrome, edge } = given as { chrome?: unknown; edge?: unknown };
    try {
      e2eListings = storeListings({
        chrome: typeof chrome === 'string' ? chrome : '',
        edge: typeof edge === 'string' ? edge : '',
      });
    } catch {
      // Not a store's listing: the page goes on as configured.
    }
  }
  return e2eListings;
}

/**
 * Xomoni's store listings (`shared/config/store-listings.ts`). The same on the server, while hydrating and after, so
 * the page never mismatches; only an end-to-end test build may swap them in the browser (`testListings`).
 */
export function useStoreListings(): StoreListings {
  return useSyncExternalStore(
    noSubscription,
    () => testListings() ?? STORE_LISTINGS,
    () => STORE_LISTINGS,
  );
}

/**
 * What /install offers this visitor (`installOffer`): a store's button, the zip guide, or why this browser or device
 * can't run Xomoni. On the server and while hydrating it is the offer for general words (`UNKNOWN_PLATFORM`).
 */
export function useInstallOffer(): InstallOffer {
  return installOffer(usePlatform(), useStoreListings());
}

/** A store offer, as `installOffer` gives it. */
type StoreOffer = Extract<InstallOffer, { kind: 'store' }>;

/** One short line under the store's button, with its icon. */
function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  const s = useStyles();
  return (
    <p className={s.note}>
      {icon}
      <span>{children}</span>
    </p>
  );
}

/**
 * The store's button for /install's top (*Add to Chrome*, *Get it for Edge*), the one thing to do there, with what to
 * know: free, no developer mode, updates itself; for Edge without its own listing, allowing the Chrome Web Store; and
 * the risks, read first.
 */
export function StoreAction({ offer }: { offer: StoreOffer }) {
  const s = useStyles();
  return (
    <>
      <div className={s.actions}>
        <ButtonLink href={offer.url} appearance="primary" size="large" icon={<PuzzlePiece20Regular />}>
          {offer.action}
        </ButtonLink>
      </div>
      <div className={s.notes}>
        <Note icon={<ShieldCheckmark16Regular className={mergeClasses(s.noteIcon, s.safe)} aria-hidden />}>
          Free and open source, from {storeInSentence(offer.store)}: no developer mode, and it updates itself.
        </Note>
        {offer.edgeFromChromeStore ? (
          <Note icon={<Info16Regular className={s.noteIcon} aria-hidden />}>
            Edge adds extensions from the Chrome Web Store too. If it asks, choose{' '}
            <strong>Allow extensions from other stores</strong>, then add Xomoni.
          </Note>
        ) : (
          offer.store === 'chrome' && (
            <Note icon={<Info16Regular className={s.noteIcon} aria-hidden />}>
              Also for Brave and the other browsers built on Chromium.
            </Note>
          )
        )}
        <Note icon={<Warning16Regular className={mergeClasses(s.noteIcon, s.warn)} aria-hidden />}>
          Automating actions on X is against X’s rules, and an account can be limited. Read{' '}
          <TextLink href="/risks">the risks</TextLink> and download your X archive first.
        </Note>
      </div>
    </>
  );
}

/**
 * The call to action to install Xomoni, for any page (the home page's *Get the extension*, #313): the store's own
 * button when a store lists Xomoni for this browser (*Add to Chrome*, *Get it for Edge*), else a link to /install with
 * `children` as its words, which is all it ever is today. Primary, with the puzzle icon.
 */
export function InstallButton({ size = 'large', children }: { size?: 'medium' | 'large'; children: ReactNode }) {
  const offer = useInstallOffer();
  return offer.kind === 'store' ? (
    <ButtonLink href={offer.url} appearance="primary" size={size} icon={<PuzzlePiece20Regular />}>
      {offer.action}
    </ButtonLink>
  ) : (
    <ButtonLink href={INSTALL_URL} appearance="primary" size={size} icon={<PuzzlePiece20Regular />}>
      {children}
    </ButtonLink>
  );
}
