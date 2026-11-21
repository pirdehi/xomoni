'use client';
// The install guide's steps on /install (#299), on Fluent UI (ADR-0019): told for the visitor's browser and computer,
// one at a time with a progress bar or all at once, moving on when the download starts and when Xomoni shows up.
// The browser is read only after hydration, so the server's page and the first render in the browser agree.
import {
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  ArrowLeft20Regular,
  ArrowRight20Regular,
  Checkmark20Regular,
  CheckmarkCircle20Filled,
  Copy16Regular,
  Desktop20Regular,
  TextBulletListLtr20Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { DOWNLOAD_URL, INSTALL_PAGE_URL } from '@/shared/config/site';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import { SendToComputer } from '@/modules/extension/ui/send-to-computer';
import {
  INSTALL_STEPS,
  type InstallStepId,
  type NavigatorHints,
  type Platform,
  STEP_AFTER_DOWNLOAD,
  STEP_ONCE_INSTALLED,
  UNKNOWN_PLATFORM,
  browserName,
  developerModeWhere,
  doneOnceInstalled,
  extensionsAddress,
  pinHow,
  platformOf,
  stepAfter,
  stepBefore,
  stepNumber,
  unzipHow,
} from '../domain/install-guide';
import { TroubleLinks } from './install-help';
import { InstallVisuals } from './install-visuals';

const WIDE = '@media (min-width: 640px)';

const useStyles = makeStyles({
  guide: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
  },
  barLabel: { ...typographyStyles.body1Strong, margin: 0, color: tokens.colorNeutralForeground2 },
  steps: { display: 'grid', gap: tokens.spacingVerticalL, margin: 0, padding: 0, listStyleType: 'none' },
  card: {
    boxSizing: 'border-box',
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    minWidth: 0,
    padding: tokens.spacingHorizontalL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    [WIDE]: { gap: tokens.spacingHorizontalL, padding: tokens.spacingHorizontalXXL },
  },
  current: {
    border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    boxShadow: tokens.shadow8,
  },
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
  numberDone: { backgroundColor: tokens.colorPaletteGreenBackground2, color: tokens.colorPaletteGreenForeground1 },
  stepBody: { minWidth: 0, flexGrow: 1 },
  stepTitle: {
    ...typographyStyles.subtitle2,
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground1,
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  text: {
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
      overflowWrap: 'anywhere',
    },
    '& strong': { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  },
  ways: {
    display: 'grid',
    rowGap: tokens.spacingVerticalS,
    margin: `${tokens.spacingVerticalS} 0 0`,
    paddingLeft: tokens.spacingHorizontalXL,
  },
  installedNote: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorPaletteGreenForeground1,
    ...typographyStyles.body1Strong,
  },
  stepAction: { marginTop: tokens.spacingVerticalM },
  nav: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: tokens.spacingHorizontalS },
  navEnd: { marginLeft: 'auto' },
  copy: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    verticalAlign: 'middle',
  },
  copyStatus: { ...typographyStyles.caption1, color: tokens.colorNeutralForeground3 },
  phoneIcon: { flexShrink: 0, marginTop: '2px', color: tokens.colorBrandForeground1 },
  // Read by screen readers, not shown: the check drawn in place of a done step's number.
  screenReaderOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
});

const noSubscription = () => () => undefined;

/** The browser's hints, as far as it gives them. */
function navigatorHints(): NavigatorHints {
  const nav = navigator as Navigator & {
    userAgentData?: { brands?: readonly { brand: string }[]; platform?: string; mobile?: boolean };
    brave?: unknown;
  };
  return {
    userAgent: nav.userAgent,
    brands: nav.userAgentData?.brands,
    platform: nav.userAgentData?.platform,
    mobile: nav.userAgentData?.mobile,
    brave: nav.brave !== undefined,
    touchPoints: nav.maxTouchPoints,
  };
}

let lastPlatform: Platform = UNKNOWN_PLATFORM;

/** The platform read now, the same object while it says the same (`useSyncExternalStore` needs a stable value). */
function readPlatform(): Platform {
  const next = platformOf(navigatorHints());
  if (next.browser !== lastPlatform.browser || next.os !== lastPlatform.os || next.phone !== lastPlatform.phone)
    lastPlatform = next;
  return lastPlatform;
}

/**
 * The visitor's browser and computer (`platformOf`). On the server and while hydrating it is `UNKNOWN_PLATFORM`, so the
 * page renders the same there and in the browser, then changes to the browser's own words.
 */
export function usePlatform(): Platform {
  return useSyncExternalStore(noSubscription, readPlatform, () => UNKNOWN_PLATFORM);
}

/**
 * Text to copy, such as an extensions page's address that web pages can't link to, shown as code with a *Copy* button.
 * Says *Copied*, or to copy it by hand when the browser refuses the clipboard.
 */
export function CopyText({ text }: { text: string }) {
  const s = useStyles();
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setResult('copied');
    } catch {
      // No clipboard here (an insecure page, or the person said no): they can still select it.
      setResult('failed');
    }
  }
  return (
    <span className={s.copy}>
      <code>{text}</code>
      <Button size="small" icon={<Copy16Regular />} aria-label={`Copy ${text}`} onClick={() => void copy()}>
        Copy
      </Button>
      <span className={s.copyStatus} role="status">
        {result === 'copied' ? 'Copied' : result === 'failed' ? 'Couldn’t copy: select it and copy it yourself' : ''}
      </span>
    </span>
  );
}

/** How the guide shows its steps: one at a time, or all of them. */
export type GuideMode = 'one' | 'all';

/** The guide's state and what moves it, from `useInstallSteps`. */
export interface InstallSteps {
  /** The step the person is on: the one shown, or the one marked when all are shown. */
  current: InstallStepId;
  mode: GuideMode;
  /** Whether Xomoni answers in this browser: the steps that install it are done. */
  installed: boolean;
  /** Goes to `step` and moves the keyboard focus to its title. */
  go: (step: InstallStepId) => void;
  /** For the download buttons: the download started, so the next step is unzipping. */
  downloaded: () => void;
  /** Shows one step at a time, or all of them. */
  setMode: (mode: GuideMode) => void;
  /** The id of a step's title, which takes the focus when the guide moves to it. */
  titleId: (step: InstallStepId) => string;
}

/**
 * The guide's state. It starts one step at a time at the first step (at following Xomoni here, if Xomoni already
 * answers), goes to unzipping when a download starts, and to following Xomoni here as soon as Xomoni answers in this
 * browser (`installed`), once: the person can still go back. The focus follows only the person's own moves, never the
 * automatic one.
 */
export function useInstallSteps(installed: boolean): InstallSteps {
  const prefix = useId();
  const [current, setCurrent] = useState<InstallStepId>(() => (installed ? STEP_ONCE_INSTALLED : INSTALL_STEPS[0]));
  const [mode, setMode] = useState<GuideMode>('one');
  const [focus, setFocus] = useState<{ step: InstallStepId } | null>(null);
  // Moving on when Xomoni shows up: adjusted while rendering, as React suggests for state that follows a value.
  const [wasInstalled, setWasInstalled] = useState(installed);
  if (installed !== wasInstalled) {
    setWasInstalled(installed);
    if (installed) setCurrent(STEP_ONCE_INSTALLED);
  }
  const titleId = (step: InstallStepId) => `${prefix}-${step}`;
  useEffect(() => {
    if (focus) document.getElementById(`${prefix}-${focus.step}`)?.focus();
  }, [focus, prefix]);
  const go = (step: InstallStepId) => {
    setCurrent(step);
    setFocus({ step });
  };
  return { current, mode, installed, go, downloaded: () => go(STEP_AFTER_DOWNLOAD), setMode, titleId };
}

/** One step's title and what it says. */
interface StepView {
  title: string;
  body: ReactNode;
}

/** What each step says, for this browser and computer. */
function useStepViews(platform: Platform, steps: InstallSteps): Record<InstallStepId, StepView> {
  const s = useStyles();
  const name = browserName(platform.browser);
  return {
    risks: {
      title: 'Read what can go wrong',
      body: (
        <p className={s.text}>
          Automating actions on X is against X’s rules, and an account can be limited. Read{' '}
          <TextLink href="/risks">the risks</TextLink> and download your X archive first.
        </p>
      ),
    },
    download: {
      title: 'Download Xomoni',
      body: (
        <>
          <p className={s.text}>
            Download <code>xomoni-extension.zip</code>, the latest version. It is free and open source.
          </p>
          <div className={s.stepAction}>
            <ButtonLink
              href={DOWNLOAD_URL}
              appearance="primary"
              icon={<ArrowDownload20Regular />}
              onClick={steps.downloaded}
            >
              Download xomoni-extension.zip
            </ButtonLink>
          </div>
        </>
      ),
    },
    unzip: {
      title: 'Unzip it into a folder you keep',
      body: (
        <>
          <p className={s.text}>{unzipHow(platform.os)}</p>
          <p className={s.text}>
            Move the <code>xomoni-extension</code> folder somewhere you keep, such as Documents. Xomoni runs from that
            folder, so don’t delete it.
          </p>
          <TroubleLinks questions={['wrong-folder', 'turned-off']} />
        </>
      ),
    },
    add: {
      title: `Add it to ${name}`,
      body: (
        <>
          <p className={s.text}>
            Open a new tab and paste this into the address bar (web pages can’t link to it):{' '}
            <CopyText key={extensionsAddress(platform.browser)} text={extensionsAddress(platform.browser)} />
          </p>
          <p className={s.text}>
            Turn on <strong>Developer mode</strong>, {developerModeWhere(platform.browser)}. Then add the{' '}
            <code>xomoni-extension</code> folder, one of two ways:
          </p>
          <ol className={mergeClasses(s.text, s.ways)}>
            <li>
              <strong>Drag the folder onto the extensions page</strong> and drop it there.
            </li>
            <li>
              Or choose <strong>Load unpacked</strong> and select the folder.
            </li>
          </ol>
          <InstallVisuals step="add" platform={platform} />
          <p className={s.text}>Xomoni opens by itself once it is added.</p>
          <TroubleLinks questions={['developer-mode', 'wrong-folder', 'developer-mode-warning']} />
        </>
      ),
    },
    connect: {
      title: 'Follow it here (optional)',
      body: (
        <>
          {steps.installed && (
            <p className={s.installedNote}>
              <CheckmarkCircle20Filled aria-hidden /> Xomoni is installed in this browser.
            </p>
          )}
          <p className={s.text}>{pinHow(platform.browser)}</p>
          <InstallVisuals step="connect" platform={platform} />
          <p className={s.text}>
            In Xomoni’s account menu, press <strong>Sign in to xomoni.com</strong> and sign in here: Xomoni signs in
            with you, and signing out on either side signs out both. Only job status is sent; your posts and likes stay
            on your computer.
          </p>
          <TroubleLinks questions={['not-recognized']} />
        </>
      ),
    },
  };
}

/** One step's card: its number (a check once Xomoni is installed), its title and what it says. */
function StepCard({
  step,
  view,
  steps,
  as: Tag,
}: {
  step: InstallStepId;
  view: StepView;
  steps: InstallSteps;
  as: 'li' | 'div';
}) {
  const s = useStyles();
  const done = steps.installed && doneOnceInstalled(step);
  const marked = steps.mode === 'all' && step === steps.current;
  return (
    <Tag className={mergeClasses(s.card, marked && s.current)} aria-current={marked ? 'step' : undefined}>
      <span className={mergeClasses(s.number, done && s.numberDone)} aria-hidden>
        {done ? <Checkmark20Regular /> : stepNumber(step)}
      </span>
      <div className={s.stepBody}>
        <h2 id={steps.titleId(step)} className={s.stepTitle} tabIndex={-1}>
          {view.title}
          {done && <span className={s.screenReaderOnly}>: done</span>}
        </h2>
        {view.body}
      </div>
    </Tag>
  );
}

/**
 * The install steps for this browser and computer (`platform`), driven by `useInstallSteps`: one at a time with a
 * progress bar, *Back* and *Next*, or all at once with the current one marked. A browser that can't run Xomoni is told
 * so first.
 */
export function InstallGuide({ platform, steps }: { platform: Platform; steps: InstallSteps }) {
  const s = useStyles();
  const progressId = useId();
  const views = useStepViews(platform, steps);
  const total = INSTALL_STEPS.length;
  const n = stepNumber(steps.current);
  const before = stepBefore(steps.current);
  const after = stepAfter(steps.current);
  return (
    <section className={s.guide} aria-label="Install steps">
      {platform.browser === 'unsupported' && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>This browser can’t run Xomoni.</MessageBarTitle>
            Open this page in Chrome, Edge or Brave on your computer to install it.
          </MessageBarBody>
        </MessageBar>
      )}
      {steps.mode === 'one' ? (
        <>
          <div className={s.bar}>
            <p id={progressId} className={s.barLabel}>
              Step {n} of {total}
            </p>
            <Button appearance="subtle" icon={<TextBulletListLtr20Regular />} onClick={() => steps.setMode('all')}>
              Show all steps
            </Button>
          </div>
          <ProgressBar
            value={n}
            max={total}
            thickness="large"
            aria-labelledby={progressId}
            aria-valuetext={`Step ${n} of ${total}`}
          />
          <StepCard step={steps.current} view={views[steps.current]} steps={steps} as="div" />
          <div className={s.nav}>
            {before && (
              <Button icon={<ArrowLeft20Regular />} onClick={() => steps.go(before)}>
                Back
              </Button>
            )}
            {after && (
              <Button
                className={s.navEnd}
                appearance={steps.current === 'download' ? 'secondary' : 'primary'}
                icon={<ArrowRight20Regular />}
                iconPosition="after"
                onClick={() => steps.go(after)}
              >
                Next
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className={s.bar}>
            <p className={s.barLabel}>All {total} steps</p>
            <Button appearance="subtle" icon={<ArrowRight20Regular />} onClick={() => steps.setMode('one')}>
              One step at a time
            </Button>
          </div>
          <ol className={s.steps}>
            {INSTALL_STEPS.map((step) => (
              <StepCard key={step} step={step} view={views[step]} steps={steps} as="li" />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** The install guide's address as a person would type it: `xomoni.com/install`. */
const INSTALL_ADDRESS = INSTALL_PAGE_URL.replace(/^https?:\/\//, '');

/**
 * What /install shows on a phone or tablet instead of the steps: Xomoni runs on a computer, with the page's address and
 * *Send to my computer* (the share sheet, else the clipboard, else an email to oneself, #243). Nothing to download.
 */
export function PhoneNotice() {
  const s = useStyles();
  const titleId = useId();
  return (
    <section className={s.card} aria-labelledby={titleId}>
      <Desktop20Regular className={s.phoneIcon} aria-hidden />
      <div className={s.stepBody}>
        <h2 id={titleId} className={s.stepTitle}>
          Xomoni runs on a computer
        </h2>
        <p className={s.text}>
          Xomoni is an extension for Chrome, Edge or Brave on a Mac or a Windows computer. Phones and tablets can’t run
          it. Send this page to your computer, or open <code>{INSTALL_ADDRESS}</code> there.
        </p>
        <SendToComputer url={INSTALL_PAGE_URL} className={s.stepAction} />
      </div>
    </section>
  );
}
