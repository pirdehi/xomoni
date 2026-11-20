import { Body1, Caption1, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowSync20Regular,
  ArrowUndo20Regular,
  CheckmarkCircle16Regular,
  ErrorCircle20Regular,
  Folder20Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import {
  type OneClickState,
  type UpdateStep,
  oneClickState,
  putBackUnfinished,
  unfinishedUpdate,
  updateOutcome,
  updateTo,
} from '../../update/update';
import { kvOwnFolderStore, pickOwnFolder, runningXomoni } from '../../update/own-folder';
import { type UpdateProblem, problemText } from '../../update/problems';
import { errorMessage } from '../format';
import { toast, useRunner } from '../hooks';
import { Button, Callout, Card } from './ui';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalS,
  },
  muted: { margin: 0, color: tokens.colorNeutralForeground3 },
  problem: { margin: 0, color: tokens.colorStatusDangerForeground1 },
  folder: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  notice: { marginBlockEnd: tokens.spacingVerticalL },
});

/** What the dashboard says while `step` of the update to `version` runs. */
export function stepText(step: UpdateStep, version: string): string {
  switch (step) {
    case 'download':
      return `Downloading Xomoni ${version} from GitHub…`;
    case 'verify':
      return 'Checking its signature and every file…';
    case 'write':
      return 'Writing the new files into Xomoni’s folder…';
    case 'reload':
      return `Restarting as Xomoni ${version}…`;
  }
}

/** Whether one-click updates work here and which folder was chosen; `refresh` looks again after a change. */
function useOneClick(): [OneClickState | undefined, () => void] {
  const [state, setState] = useState<OneClickState>();
  const refresh = useCallback(() => {
    oneClickState().then(setState, () => setState({ ready: false, why: 'unsupported' }));
  }, []);
  useEffect(refresh, [refresh]);
  return [state, refresh];
}

/** Opens the folder picker and keeps Xomoni's folder; says why when the folder chosen isn't it. */
async function chooseFolder(): Promise<string | null> {
  const pick = await pickOwnFolder(kvOwnFolderStore, runningXomoni());
  if (pick.folder) toast(`Xomoni will update itself in “${pick.folder.name}”.`, 'good');
  return pick.problem ?? null;
}

/**
 * The one-click update inside the notice that a newer version is out (#305, ADR-0033), for a zip install: *Set up
 * one-click updates* until Xomoni's folder is chosen, then *Update now*, with each step as it runs and why it stopped.
 * Disabled while this tab's runner works; the update itself also refuses while any tab's does. Shows nothing for a
 * store install, and one line where this browser or this build can't check a release.
 */
export function OneClickUpdate({ version }: { version: string }) {
  const styles = useStyles();
  const run = useRunner();
  const current = chrome.runtime.getManifest().version;
  const [state, refresh] = useOneClick();
  const [step, setStep] = useState<UpdateStep | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stopped, setStopped] = useState<UpdateProblem | null>(null);
  // From the click on: Chrome's prompts come before the first step, and a second click must not start another update.
  const [busy, setBusy] = useState(false);

  if (!state || (!state.ready && state.why === 'not-zip')) return null;
  if (!state.ready) {
    return (
      <Caption1 as="p" block className={styles.muted}>
        {problemText(state.why, version, current)}
      </Caption1>
    );
  }

  const setUp = async () => {
    setBusy(true);
    setProblem(null);
    setStopped(null);
    setProblem(await chooseFolder().catch(errorMessage));
    setBusy(false);
    refresh();
  };

  const update = async () => {
    setBusy(true);
    setProblem(null);
    setStopped(null);
    setStep(null);
    try {
      const result = await updateTo(version, setStep);
      // Done: Chrome reloads Xomoni and closes this page, so the button stays disabled until then.
      if (result.ok) return;
      setStopped(result.problem);
      setProblem(problemText(result.problem, version, current));
    } catch (err) {
      setProblem(`Couldn’t update: ${errorMessage(err)}. Nothing was changed.`);
    }
    setStep(null);
    setBusy(false);
  };

  const needsFolder = !state.folder || stopped === 'wrong-folder' || stopped === 'no-folder';
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        {needsFolder ? (
          <Button variant="primary" size="sm" icon={<Folder20Regular />} onClick={() => void setUp()} disabled={busy}>
            {state.folder ? 'Choose Xomoni’s folder again' : 'Set up one-click updates'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={<ArrowSync20Regular />}
            onClick={() => void update()}
            disabled={busy || run.status !== 'idle'}
          >
            Update now
          </Button>
        )}
        {step && <Spinner size="tiny" label={stepText(step, version)} />}
      </div>
      {needsFolder && !problem && (
        <Caption1 as="p" block className={styles.muted}>
          Once: choose the folder you loaded Xomoni from, and let Xomoni change it. Each update is then one click: the
          new version comes from GitHub, its signature is checked, and your data stays.
        </Caption1>
      )}
      {!needsFolder && run.status !== 'idle' && !problem && (
        <Caption1 as="p" block className={styles.muted}>
          Xomoni updates only while no job runs.
        </Caption1>
      )}
      {problem && (
        <Body1 as="p" block role="alert" className={styles.problem}>
          {problem}
        </Body1>
      )}
    </div>
  );
}

/**
 * Settings' *Updates* card (#305, ADR-0033): which version runs, and for a zip install, Xomoni's folder for one-click
 * updates: choose it, choose another or forget it. A store install says the store updates it.
 */
export function UpdatesCard() {
  const styles = useStyles();
  const current = chrome.runtime.getManifest().version;
  const [state, refresh] = useOneClick();
  const [problem, setProblem] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  const choose = async () => {
    setChoosing(true);
    setProblem(await chooseFolder().catch(errorMessage));
    setChoosing(false);
    refresh();
  };
  const forget = async () => {
    await kvOwnFolderStore.set(null);
    setProblem(null);
    refresh();
  };

  return (
    <Card title="Updates" subtitle={`This browser runs Xomoni ${current}.`}>
      <div className={styles.stack}>
        {!state ? null : !state.ready ? (
          <Caption1 as="p" block className={styles.muted}>
            {problemText(state.why, current, current)}
          </Caption1>
        ) : (
          <>
            <Caption1 as="p" block className={styles.muted}>
              When a new version is out, Xomoni can update itself in one click: it downloads the release from GitHub,
              checks its signature and every file, writes it into its own folder, never while a job runs, and restarts.
              Your data stays.
            </Caption1>
            {state.folder ? (
              <Body1 as="p" block className={styles.folder}>
                <CheckmarkCircle16Regular aria-hidden /> Xomoni’s folder: “{state.folder}”
              </Body1>
            ) : null}
            <div className={styles.row}>
              <Button icon={<Folder20Regular />} onClick={() => void choose()} disabled={choosing}>
                {state.folder ? 'Choose another folder' : 'Choose Xomoni’s folder'}
              </Button>
              {state.folder && (
                <Button variant="ghost" onClick={() => void forget()}>
                  Forget the folder
                </Button>
              )}
            </div>
          </>
        )}
        {problem && (
          <Body1 as="p" block role="alert" className={styles.problem}>
            {problem}
          </Body1>
        )}
      </div>
    </Card>
  );
}

/**
 * Above every page (#305): after a one-click update, whether the new version is the one running (said once, as a
 * toast), and an update cut short while writing, with *Put back* to restore the version it replaced.
 */
export function UpdateRecovery() {
  const styles = useStyles();
  const unfinished = useLiveQuery(() => unfinishedUpdate());
  const [putting, setPutting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    updateOutcome().then(
      (outcome) => {
        if (!outcome) return;
        if (outcome.took) toast(`Xomoni updated to ${outcome.version}. Your data is all here.`, 'good');
        else
          toast(
            `Xomoni ${outcome.version} was written, but Chrome still runs ${outcome.running}: it loads Xomoni from another folder. Choose that folder in Settings › Updates.`,
            'critical',
          );
      },
      () => undefined,
    );
  }, []);

  if (!unfinished) return null;
  const putBack = async () => {
    setPutting(true);
    setProblem(null);
    const result = await putBackUnfinished().catch(() => 'failed' as const);
    setPutting(false);
    const words = {
      restored: null,
      failed: 'Some files couldn’t be put back. Try again, or download Xomoni again by hand.',
      busy: problemText('busy', unfinished.to, unfinished.from),
      'no-folder': 'Xomoni’s folder was forgotten. Download Xomoni again by hand to repair it.',
      'needs-click': `Chrome wants a fresh click before it asks about Xomoni’s folder. Press Put back ${unfinished.from} again.`,
      'folder-denied': problemText('folder-denied', unfinished.to, unfinished.from),
    }[result];
    setProblem(words);
  };
  return (
    <div className={styles.notice}>
      <Callout
        tone="critical"
        icon={<ErrorCircle20Regular />}
        title={`The update to Xomoni ${unfinished.to} didn’t finish`}
      >
        <Body1 as="p" block>
          Some of its files may be in Xomoni’s folder already. Put back {unfinished.from} before Chrome reloads Xomoni.
        </Body1>
        <div className={styles.row}>
          <Button
            size="sm"
            variant="primary"
            icon={<ArrowUndo20Regular />}
            onClick={() => void putBack()}
            disabled={putting}
          >
            Put back {unfinished.from}
          </Button>
          {putting && <Spinner size="tiny" label="Putting the old files back…" />}
        </div>
        {problem && (
          <Body1 as="p" block role="alert" className={styles.problem}>
            {problem}
          </Body1>
        )}
      </Callout>
    </div>
  );
}
