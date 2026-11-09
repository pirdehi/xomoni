import { Caption1, Link, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import { ErrorCircle16Regular, FolderArrowRight16Regular, FolderSearch16Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Account } from '../../shared/types';
import {
  type FolderHandle,
  type FolderPickerHost,
  type FolderStore,
  canRead,
  chooseFolder,
  importNewestArchive,
  kvFolderStore,
} from '../downloads-folder';
import { fmtNumber } from '../format';
import { toast } from '../hooks';
import type { ImportResult } from '../importArchive';
import { Button, Callout } from './ui';

/** What the toast says once X's archive was imported from Downloads, here or by the dashboard's own look (#186). */
export const importedToast = (r: ImportResult) =>
  `Imported X’s archive from Downloads: ${fmtNumber(r.tweets)} posts and ${fmtNumber(r.likes)} likes`;

const useStyles = makeStyles({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  text: { flexGrow: 1, minWidth: '12rem', color: tokens.colorNeutralForeground2 },
  error: { marginTop: tokens.spacingVerticalS },
});

/** What the watcher is doing: no folder yet, waiting for the person to allow reading it, watching, or importing. */
type Watch =
  | { state: 'loading' }
  | { state: 'off' }
  | { state: 'blocked'; folder: FolderHandle }
  | { state: 'watching'; folder: FolderHandle }
  | { state: 'importing'; folder: FolderHandle; name: string; progress: string };

/**
 * X's archive found in Downloads by itself (#187). Once the person lets Xomoni read their Downloads folder, a ZIP
 * named like X's archive that lands there is imported with no drop and no picker, while this is on screen. A file is
 * imported once, even if it fails (it says why). When the browser wants the reading allowed again, one click does it.
 * Browsers without the folder picker show nothing; the drop zone above still works.
 */
export function DownloadsWatch({
  account,
  store = kvFolderStore,
  host,
  intervalMs = 10_000,
}: {
  account: Account;
  store?: FolderStore;
  host?: FolderPickerHost;
  intervalMs?: number;
}) {
  const s = useStyles();
  const [watch, setWatch] = useState<Watch>({ state: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const checking = useRef(false);
  const pickerHost = host ?? (window as unknown as FolderPickerHost);
  const supported = typeof pickerHost.showDirectoryPicker === 'function';

  useEffect(() => {
    let live = true;
    void store.get().then((folder) => {
      if (live) setWatch(folder ? { state: 'watching', folder } : { state: 'off' });
    });
    return () => {
      live = false;
    };
  }, [store]);

  const check = useCallback(
    async (folder: FolderHandle, ask: boolean) => {
      if (checking.current) return;
      checking.current = true;
      try {
        if (!(await canRead(folder, ask))) {
          setWatch({ state: 'blocked', folder });
          return;
        }
        setWatch((w) => (w.state === 'importing' ? w : { state: 'watching', folder }));
        const found = await importNewestArchive(account, folder, (progress) =>
          setWatch({ state: 'importing', folder, name: 'X’s archive', progress }),
        );
        setWatch({ state: 'watching', folder });
        if (!found) return;
        if (found.error != null) setError(`${found.file.name}: ${found.error}`);
        else {
          setError(null);
          toast(importedToast(found.result), 'good');
        }
      } catch {
        // The folder was moved, deleted or can't be listed now; the next look tries again.
      } finally {
        checking.current = false;
      }
    },
    [account],
  );

  const folder = watch.state === 'watching' || watch.state === 'importing' ? watch.folder : null;
  useEffect(() => {
    if (!folder) return;
    // The first look right after this render, then one every `intervalMs` while the page is on screen.
    const first = setTimeout(() => void check(folder, false), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check(folder, false);
    }, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [folder, check, intervalMs]);

  const connect = async () => {
    const chosen = await chooseFolder(pickerHost);
    if (!chosen) return;
    await store.set(chosen);
    setWatch({ state: 'watching', folder: chosen });
  };
  const stop = async () => {
    await store.set(null);
    setWatch({ state: 'off' });
    setError(null);
  };

  if (watch.state === 'loading' || (watch.state === 'off' && !supported)) return null;
  return (
    <div>
      <div className={s.row} data-state={watch.state}>
        {watch.state === 'off' && (
          <>
            <Caption1 className={s.text}>Let Xomoni find it in your Downloads folder and import it by itself.</Caption1>
            <Button size="sm" icon={<FolderSearch16Regular />} onClick={() => void connect()}>
              Choose Downloads folder
            </Button>
          </>
        )}
        {watch.state === 'blocked' && (
          <>
            <Caption1 className={s.text}>Chrome asks again before Xomoni reads “{watch.folder.name}”.</Caption1>
            <Button
              size="sm"
              variant="primary"
              icon={<FolderArrowRight16Regular />}
              onClick={() => void check(watch.folder, true)}
            >
              Allow reading Downloads
            </Button>
          </>
        )}
        {watch.state === 'watching' && (
          <>
            <Caption1 className={s.text}>
              Watching “{watch.folder.name}” for X’s archive. When it lands there, it is imported by itself.
            </Caption1>
            <Link as="button" onClick={() => void stop()}>
              Stop
            </Link>
          </>
        )}
        {watch.state === 'importing' && <Spinner size="tiny" label={`Importing ${watch.name}: ${watch.progress}`} />}
      </div>
      {error && (
        <div className={s.error}>
          <Callout tone="critical" icon={<ErrorCircle16Regular />}>
            {error}
          </Callout>
        </div>
      )}
    </div>
  );
}
