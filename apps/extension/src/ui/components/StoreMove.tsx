import {
  Body1,
  Body1Strong,
  Caption1,
  Link,
  Spinner,
  Subtitle2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  ArrowSync20Regular,
  Checkmark16Regular,
  CheckmarkCircle16Regular,
  Open16Regular,
  Open20Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { STORE_LISTINGS, type StoreListings } from '../../shared/store-listings';
import { errorMessage } from '../format';
import { toast } from '../hooks';
import {
  MOVE_GUIDE_URL,
  dismissStoreMove,
  extensionsAddress,
  loadedUnpacked,
  openExtensionsPage,
  storeMoveWanted,
  thisBrowsersStore,
} from '../store-move';
import { saveEverything } from './MoveData';
import { Button } from './ui';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    marginBottom: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke2}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  head: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalM },
  headIcon: { display: 'inline-flex', flexShrink: 0, marginTop: '2px', color: tokens.colorBrandForeground1 },
  headText: { flexGrow: 1, minWidth: 0 },
  title: { display: 'block', margin: 0, color: tokens.colorNeutralForeground1 },
  lead: { margin: `${tokens.spacingVerticalXXS} 0 0`, color: tokens.colorNeutralForeground2 },
  steps: {
    display: 'grid',
    rowGap: tokens.spacingVerticalS,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  number: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  numberDone: { backgroundColor: tokens.colorPaletteGreenBackground2, color: tokens.colorPaletteGreenForeground1 },
  stepBody: { display: 'grid', rowGap: tokens.spacingVerticalXS, flexGrow: 1, minWidth: 0 },
  stepTitle: { margin: 0, color: tokens.colorNeutralForeground1 },
  stepText: { margin: 0, color: tokens.colorNeutralForeground2, '& code': { fontFamily: tokens.fontFamilyMonospace } },
  stepAction: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalXS,
  },
  saved: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorPaletteGreenForeground1,
  },
  foot: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
});

/** One step of the move: its number (a check once done), its title, what it says and what to press. */
function Step({ n, title, done = false, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  const styles = useStyles();
  return (
    <li className={styles.step}>
      <span className={mergeClasses(styles.number, done && styles.numberDone)} aria-hidden>
        {done ? <Checkmark16Regular /> : n}
      </span>
      <div className={styles.stepBody}>
        {/* Named in one string: a hidden ": done" placed apart was read "Export everything : done" (#457). */}
        <Body1Strong as="h3" className={styles.stepTitle} aria-label={done ? `${title}: done` : undefined}>
          {title}
        </Body1Strong>
        {children}
      </div>
    </li>
  );
}

/**
 * The card on Home that brings a zip install to its store (#304): shown only while this Xomoni was loaded unpacked
 * (`loadedUnpacked`), a store lists it for this browser (`thisBrowsersStore`, from `listings`, the configured ones
 * unless a test passes its own), and the person hasn't said *Not now* (`storeMoveWanted`). Four steps, each the
 * person's own:
 * 1. *Export everything*, the export Settings runs (`saveEverything`), ticked once the file is saved;
 * 2. remove this copy on the extensions page, which this only opens;
 * 3. add Xomoni from the store, in a new tab;
 * 4. import the file in the new Xomoni.
 *
 * It never removes anything and never says the data moves by itself. The same steps are on xomoni.com
 * (`MOVE_GUIDE_URL`), which stays open once this page closes with the copy. Placed on Home, apart from the notice of a
 * newer version above every page.
 */
export function StoreMoveCard({ listings = STORE_LISTINGS }: { listings?: StoreListings }) {
  const styles = useStyles();
  const titleId = useId();
  const store = thisBrowsersStore(listings);
  const hasStore = store !== null;
  const [unpacked, setUnpacked] = useState(false);
  // Nothing is read while no store lists Xomoni for this browser, as today.
  const wanted = useLiveQuery(async () => (hasStore ? storeMoveWanted() : false), [hasStore]);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!hasStore) return;
    let live = true;
    void loadedUnpacked().then((answer) => {
      if (live) setUnpacked(answer);
    });
    return () => {
      live = false;
    };
  }, [hasStore]);
  if (!store || !unpacked || !wanted) return null;

  const exportNow = async () => {
    setSaving(true);
    const name = await saveEverything();
    setSaving(false);
    if (name) setSaved(name);
  };
  const openExtensions = () =>
    void openExtensionsPage().catch((err: unknown) =>
      toast(`Couldn’t open it (${errorMessage(err)}). Type ${extensionsAddress()} into a new tab.`, 'critical'),
    );
  const dismiss = () => void dismissStoreMove().catch((err: unknown) => toast(errorMessage(err), 'critical'));

  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden>
          <ArrowSync20Regular />
        </span>
        <div className={styles.headText}>
          <Subtitle2 as="h2" id={titleId} className={styles.title}>
            Xomoni is in {store.name}: it updates itself
          </Subtitle2>
          <Body1 as="p" className={styles.lead}>
            This Xomoni was added from a zip, so it never updates by itself. Move to the store’s Xomoni in four steps.
            Your data comes along only in the file you save in step 1.
          </Body1>
        </div>
      </div>

      <ol className={styles.steps} aria-label="Steps to move to the store">
        <Step n={1} title="Export everything" done={saved !== null}>
          <Body1 as="p" className={styles.stepText}>
            One file with your accounts, posts, likes, jobs, settings and Watch, saved in Downloads. It stays on your
            computer.
          </Body1>
          <div className={styles.stepAction}>
            {saving ? (
              <Spinner size="tiny" label="Exporting…" />
            ) : (
              <Button variant="primary" icon={<ArrowDownload20Regular />} onClick={() => void exportNow()}>
                Export everything
              </Button>
            )}
            {saved && (
              <Caption1 role="status" className={styles.saved}>
                <CheckmarkCircle16Regular aria-hidden /> Saved {saved} in Downloads.
              </Caption1>
            )}
          </div>
        </Step>
        <Step n={2} title="Remove this copy">
          <Body1 as="p" className={styles.stepText}>
            While no job runs, press <strong>Remove</strong> on Xomoni on the extensions page. The browser deletes this
            copy’s data, and your file keeps it. This page closes too, so open the steps on xomoni.com first.
          </Body1>
          <div className={styles.stepAction}>
            <Button icon={<Open20Regular />} onClick={openExtensions}>
              Open the extensions page
            </Button>
          </div>
        </Step>
        <Step n={3} title="Install it from the store">
          <Body1 as="p" className={styles.stepText}>
            <Link href={store.url} target="_blank" rel="noreferrer noopener">
              Xomoni in {store.name} <Open16Regular aria-hidden />
            </Link>
            {store.edgeFromChromeStore
              ? '. Edge adds extensions from the Chrome Web Store too: if it asks, choose Allow extensions from other stores.'
              : '. The new Xomoni opens by itself once it is added.'}
          </Body1>
        </Step>
        <Step n={4} title="Import the file">
          <Body1 as="p" className={styles.stepText}>
            In the new Xomoni, choose <strong>Import your data</strong> on Home and pick the file. It is checked, then
            added: nothing is replaced with less or deleted.
          </Body1>
        </Step>
      </ol>

      <div className={styles.foot}>
        <Link href={MOVE_GUIDE_URL} target="_blank" rel="noreferrer noopener">
          Open these steps on xomoni.com <Open16Regular aria-hidden />
        </Link>
        <Button variant="ghost" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
