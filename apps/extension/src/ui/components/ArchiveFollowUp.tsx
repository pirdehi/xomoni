import { useEffect, useRef } from 'react';
import { runner } from '../../engine/platform';
import type { Account } from '../../shared/types';
import { type LookRunner, importIfDownloaded, lookIfDue } from '../archive-follow-up';
import { type FolderStore, kvFolderStore } from '../downloads-folder';
import { toast } from '../hooks';
import { importedToast } from './DownloadsWatch';

/**
 * Gets X's archive the rest of the way by itself once the person asked for it (#186), on whichever page of the
 * dashboard is open: looks at X's page when a look is due (every `lookEveryMs`), and imports the downloaded ZIP from
 * the Downloads folder (every `importEveryMs`) unless the Library is on screen, which does that itself. Shows
 * nothing but a toast for what it imported.
 */
export function ArchiveFollowUp({
  account,
  libraryOpen,
  run = runner,
  store = kvFolderStore,
  lookEveryMs = 60_000,
  importEveryMs = 10_000,
}: {
  account: Account;
  libraryOpen: boolean;
  run?: LookRunner;
  store?: FolderStore;
  lookEveryMs?: number;
  importEveryMs?: number;
}) {
  const looking = useRef(false);
  const importing = useRef(false);

  useEffect(() => {
    // One look at a time: the next one waits for this one to have remembered itself.
    const look = () => {
      if (looking.current) return;
      looking.current = true;
      void lookIfDue(account.id, run)
        .catch(() => {})
        .finally(() => (looking.current = false));
    };
    const first = setTimeout(look, Math.min(lookEveryMs, 5_000));
    const timer = setInterval(look, lookEveryMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [account.id, run, lookEveryMs]);

  useEffect(() => {
    if (libraryOpen) return;
    const check = async () => {
      if (importing.current) return;
      importing.current = true;
      try {
        const found = await importIfDownloaded(account, store);
        if (found?.error != null) toast(`${found.file.name}: ${found.error}`, 'critical');
        else if (found) toast(importedToast(found.result), 'good');
      } catch {
        // The folder was moved or can't be listed now; the next look tries again.
      } finally {
        importing.current = false;
      }
    };
    const timer = setInterval(() => void check(), importEveryMs);
    return () => clearInterval(timer);
  }, [account, libraryOpen, store, importEveryMs]);

  return null;
}
