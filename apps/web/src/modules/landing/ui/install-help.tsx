'use client';
// The install questions on /install (#306), on Fluent UI (ADR-0019): short answers to what goes wrong when installing
// from the zip, each under its own heading and anchor, listed at the top; and `TroubleLinks`, the steps' way to them.
// Rendered on the server with the page. The visitor's own browser is marked only once the page knows it
// (`usePlatform`), so the server's page and the first render in the browser agree.
import { Badge, makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { QuestionCircle16Regular } from '@fluentui/react-icons';
import { Fragment, type ReactNode } from 'react';
import { ISSUES_URL, SECURITY_URL } from '@/shared/config/site';
import { TextLink } from '@/shared/ui/links';
import { type Platform, extensionsAddress, unzipHow } from '../domain/install-guide';
import {
  DEVELOPER_MODE_PLACES,
  INSTALL_HELP_ID,
  INSTALL_QUESTIONS,
  type InstallQuestionId,
  ownQuestion,
  questionHref,
} from '../domain/install-help';

const WIDE = '@media (min-width: 640px)';
// Below the sticky site header (64 px), with some room.
const BELOW_HEADER = '80px';

const useStyles = makeStyles({
  help: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL, scrollMarginTop: BELOW_HEADER },
  title: {
    ...typographyStyles.title2,
    margin: 0,
    color: tokens.colorNeutralForeground1,
  },
  lead: {
    margin: 0,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.6',
  },
  card: {
    boxSizing: 'border-box',
    minWidth: 0,
    padding: tokens.spacingHorizontalL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    [WIDE]: { padding: tokens.spacingHorizontalXXL },
  },
  questions: {
    display: 'grid',
    rowGap: tokens.spacingVerticalS,
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.5',
  },
  answer: {
    scrollMarginTop: BELOW_HEADER,
    // The answer a link just led to.
    ':target': { border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`, boxShadow: tokens.shadow8 },
  },
  own: { border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}` },
  answerHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  question: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
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
  list: {
    display: 'grid',
    rowGap: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalXL,
  },
  trouble: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  troubleIcon: { flexShrink: 0, marginTop: '2px' },
});

/** Each question as its heading says it, and as the steps' links name it. */
const QUESTION_TITLES: Record<InstallQuestionId, string> = {
  'developer-mode': 'Where is Developer mode?',
  'wrong-folder': 'Which folder do I add?',
  'turned-off': 'Xomoni disappeared or is turned off',
  'developer-mode-warning': 'Why does the browser warn about developer mode?',
  update: 'How do I update Xomoni?',
  'not-recognized': 'Why doesn’t xomoni.com see Xomoni yet?',
  browsers: 'Can I use Firefox, Safari or a phone?',
  'your-data': 'Where is my data, and what if I remove Xomoni?',
  ask: 'Where can I ask for help?',
};

/** What each question's answer says, for this browser (its own extensions page, and its line marked). */
function useAnswers(platform: Platform): Record<InstallQuestionId, ReactNode> {
  const s = useStyles();
  const address = extensionsAddress(platform.browser);
  const text = s.text;
  const list = mergeClasses(s.text, s.list);
  return {
    'developer-mode': (
      <>
        <p className={text}>
          <strong>Developer mode</strong> is a switch on the browser’s extensions page. Xomoni can be added only while
          it is on. Paste the page’s address into a new tab:
        </p>
        <ul className={list}>
          {DEVELOPER_MODE_PLACES.map((place) => (
            <li key={place.browser}>
              <strong>{place.name}</strong>
              {!platform.phone && platform.browser === place.browser && (
                <>
                  {' '}
                  <Badge appearance="tint" color="brand" shape="rounded">
                    Your browser
                  </Badge>
                </>
              )}
              : <code>{place.address}</code>, {place.where}.
              {place.browser === 'edge' &&
                ' No panel? Make the window wider, or open the menu at the top left of the page.'}
            </li>
          ))}
        </ul>
        <p className={text}>You turn it on once, and you can leave it on.</p>
      </>
    ),
    'wrong-folder': (
      <>
        <p className={text}>
          The <code>xomoni-extension</code> folder you unzipped: the one with <code>manifest.json</code> directly inside
          it. If the browser says <strong>Manifest file is missing or unreadable</strong>, another folder was chosen.
        </p>
        <p className={text}>Unzip the download first. The browser can’t add the .zip file itself.</p>
        <ul className={list}>
          <li>
            <strong>On a Mac:</strong> {unzipHow('mac')}
          </li>
          <li>
            <strong>On Windows:</strong> {unzipHow('windows')} A zip opens like a folder in Windows, but the browser
            can’t use it until it is extracted.
          </li>
        </ul>
        <p className={text}>
          Then choose the folder that holds <code>manifest.json</code>: not Downloads, and not a folder inside
          xomoni-extension.
        </p>
      </>
    ),
    'turned-off': (
      <>
        <p className={text}>
          The browser runs Xomoni from the folder you added. If that folder was moved, renamed or deleted, Xomoni stops:
          it may show an error, be turned off or be gone from the list.
        </p>
        <ul className={list}>
          <li>
            Put the folder back where it was, with the same name. Then open <code>{address}</code> and press the reload
            button on Xomoni’s card.
          </li>
          <li>If the folder is gone, download Xomoni again and unzip it to that same place first.</li>
          <li>If Xomoni’s switch is off, turn it back on.</li>
          <li>
            If Xomoni isn’t on the extensions page anymore, add it again with the steps above. Added from another place,
            it starts empty: import your data if you exported it.
          </li>
        </ul>
      </>
    ),
    'developer-mode-warning': (
      <>
        <p className={text}>
          Chrome, Edge and Brave may warn about extensions in developer mode, sometimes each time they start, and offer
          to turn them off. They say this about every extension added from a folder, not about Xomoni in particular.
        </p>
        <p className={text}>
          To keep Xomoni, close the warning without turning extensions off. If Xomoni was turned off, turn its switch
          back on in <code>{address}</code>.
        </p>
        <p className={text}>
          Xomoni’s code is open, and each release is built by GitHub Actions from a tagged commit, with a checksum. Once
          Xomoni is in the Chrome Web Store and Edge Add-ons, installing it from there needs no developer mode.
        </p>
      </>
    ),
    update: (
      <>
        <ol className={list}>
          <li>Download the latest xomoni-extension.zip from the top of this page, and unzip it.</li>
          <li>Replace everything in your xomoni-extension folder with the new files. Keep the folder where it is.</li>
          <li>
            Open <code>{address}</code> and press the reload button on Xomoni’s card.
          </li>
        </ol>
        <p className={text}>
          Your data stays: the browser keeps it, not the folder. Update while no job is running, and don’t remove Xomoni
          to update it, because removing it deletes its data.
        </p>
        <p className={text}>
          Coming soon: updating with one click from Xomoni, and installing it from the Chrome Web Store and Edge
          Add-ons, which update it for you.
        </p>
      </>
    ),
    'not-recognized': (
      <>
        <p className={text}>
          Web pages can’t look for extensions. xomoni.com learns that Xomoni is in this browser when Xomoni opens one of
          its pages, and then remembers it.
        </p>
        <p className={text}>
          So open Xomoni once: click the puzzle icon next to the address bar, then Xomoni. In its account menu, press{' '}
          <strong>Sign in to xomoni.com</strong>. The Welcome page Xomoni opens when it is added does the same.
        </p>
        <p className={text}>
          Use the browser and profile where you added Xomoni. Then come back to this page: <em>Where you are</em>, at
          the top, ticks by itself.
        </p>
      </>
    ),
    browsers: (
      <>
        <p className={text}>
          No. Xomoni runs in Chrome, Edge or Brave, version 116 or later, on a computer. Firefox and Safari can’t run
          it, and neither can phones or tablets, iPads included.
        </p>
        <p className={text}>xomoni.com works on a phone too, to follow what Xomoni does on your computer.</p>
      </>
    ),
    'your-data': (
      <>
        <p className={text}>
          Xomoni keeps what it finds and does (your posts and likes, jobs, the activity log and settings) inside the
          browser, on your computer. Not in the xomoni-extension folder, and not on a server: xomoni.com only gets job
          status, and only if you sign in.
        </p>
        <p className={text}>
          Removing Xomoni from the browser deletes all of it, for good. Export it first: in Xomoni, open{' '}
          <strong>Settings › Move your data › Export everything</strong>. The file is saved in Downloads, and{' '}
          <strong>Import from a file</strong> brings it into a new Xomoni.
        </p>
      </>
    ),
    ask: (
      <>
        <p className={text}>
          Open an issue on <TextLink href={ISSUES_URL}>GitHub</TextLink>. Say which browser and version, which computer,
          and what you see; a screenshot of the extensions page helps. Issues are public, so leave out anything private.
          Xomoni never needs your X password.
        </p>
        <p className={text}>
          For a security problem, follow the <TextLink href={SECURITY_URL}>security policy</TextLink> instead.
        </p>
      </>
    ),
  };
}

/**
 * The install questions at the end of /install: a heading, every question linking to its answer, then each answer
 * under its own heading and anchor (`INSTALL_QUESTIONS`), so a link can lead to one (`/install#developer-mode`). Words
 * follow `platform`: its extensions page, its line in *Developer mode* marked, and on a phone or in a browser that
 * can't run Xomoni, the answer about that marked (`ownQuestion`).
 */
export function InstallHelp({ platform }: { platform: Platform }) {
  const s = useStyles();
  const own = ownQuestion(platform);
  const answers = useAnswers(platform);
  const titleId = `${INSTALL_HELP_ID}-title`;
  return (
    <section id={INSTALL_HELP_ID} className={s.help} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.title}>
        Install help
      </h2>
      <p className={s.lead}>Short answers to what goes wrong most often.</p>
      <nav className={s.card} aria-label="Install questions">
        <ul className={s.questions}>
          {INSTALL_QUESTIONS.map((question) => (
            <li key={question}>
              <TextLink href={questionHref(question)}>{QUESTION_TITLES[question]}</TextLink>
            </li>
          ))}
        </ul>
      </nav>
      {INSTALL_QUESTIONS.map((question) => (
        <div key={question} id={question} className={mergeClasses(s.card, s.answer, question === own && s.own)}>
          <div className={s.answerHead}>
            <h3 className={s.question}>{QUESTION_TITLES[question]}</h3>
            {question === own && (
              <Badge appearance="tint" color="brand" shape="rounded">
                {platform.phone ? 'Your device' : 'Your browser'}
              </Badge>
            )}
          </div>
          {answers[question]}
        </div>
      ))}
    </section>
  );
}

/**
 * *Trouble?* and a link to each of `questions`' answers further down the same page, for a step of the guide. The link
 * is the fragment alone, so following it keeps the step the person is on.
 */
export function TroubleLinks({ questions }: { questions: readonly InstallQuestionId[] }) {
  const s = useStyles();
  return (
    <p className={s.trouble}>
      <QuestionCircle16Regular className={s.troubleIcon} aria-hidden />
      <span>
        Trouble?{' '}
        {questions.map((question, i) => (
          <Fragment key={question}>
            {i > 0 && <span aria-hidden> · </span>}
            <TextLink href={questionHref(question)}>{QUESTION_TITLES[question]}</TextLink>
          </Fragment>
        ))}
      </span>
    </p>
  );
}
