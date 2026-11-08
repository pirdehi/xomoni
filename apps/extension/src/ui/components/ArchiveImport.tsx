import { Body1, Caption1, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import {
  Archive16Regular,
  Archive20Regular,
  FolderOpen16Regular,
  FolderZip16Regular,
  LockClosed12Regular,
} from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import type { Account } from '../../shared/types';
import { fmtNumber } from '../format';
import { toast } from '../hooks';
import { ARCHIVE_FILE, markArchiveSeen } from '../downloads-folder';
import { importArchive } from '../importArchive';
import { pickZipInDownloads } from '../pick-zip';
import { Button, Callout } from './ui';

const useStyles = makeStyles({
  dropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  dropIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    marginBottom: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  dropText: { margin: 0, color: tokens.colorNeutralForeground1 },
  dropActions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalM,
  },
  busy: { color: tokens.colorNeutralForeground2 },
  error: { marginTop: tokens.spacingVerticalM },
  note: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground3,
  },
});

/**
 * Where X's archive comes in (#184): the ZIP X sends, dropped (even from Chrome's downloads) or chosen in a picker
 * that opens in Downloads, or the unzipped folder. Only `account.js`, `tweets.js` and `like.js` are read, on this
 * computer; a failure says why and imports nothing.
 */
export function ArchiveImport({ account }: { account: Account }) {
  const styles = useStyles();
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const run = async (list: FileList | readonly File[] | null) => {
    if (!list?.length) return;
    setError(null);
    setBusy('Starting…');
    try {
      const files = [...list];
      const r = await importArchive(files, account, setBusy);
      // A ZIP imported by hand is not imported again when Xomoni finds it in Downloads (#187).
      for (const file of files) if (ARCHIVE_FILE.test(file.name)) await markArchiveSeen(account.id, file);
      toast(`Imported ${fmtNumber(r.tweets)} posts and ${fmtNumber(r.likes)} likes`, 'good');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (folderInput.current) folderInput.current.value = '';
      if (zipInput.current) zipInput.current.value = '';
    }
  };
  // The picker opens in Downloads, where Chrome saved X's ZIP; a browser without it gets the plain file input.
  const chooseZip = async () => {
    const picked = await pickZipInDownloads();
    if (picked === undefined) zipInput.current?.click();
    else if (picked) await run([picked]);
  };

  return (
    <div>
      <div
        className={styles.dropZone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void run(e.dataTransfer.files);
        }}
      >
        {busy ? (
          <Spinner size="tiny" label={{ children: busy, className: styles.busy }} />
        ) : (
          <>
            <span className={styles.dropIcon}>
              <Archive20Regular aria-hidden />
            </span>
            <Body1 as="p" className={styles.dropText}>
              Drop your X archive here (twitter-….zip)
            </Body1>
            <div className={styles.dropActions}>
              <Button size="sm" variant="primary" icon={<FolderZip16Regular />} onClick={() => void chooseZip()}>
                Choose ZIP file
              </Button>
              <Button size="sm" icon={<FolderOpen16Regular />} onClick={() => folderInput.current?.click()}>
                Choose unzipped folder
              </Button>
            </div>
          </>
        )}
      </div>
      <input ref={folderInput} type="file" multiple hidden onChange={(e) => void run(e.target.files)} />
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="zip-input"
        onChange={(e) => void run(e.target.files)}
      />
      {error && (
        <div className={styles.error}>
          <Callout tone="critical" icon={<Archive16Regular />}>
            {error}
          </Callout>
        </div>
      )}
      <Caption1 as="p" className={styles.note}>
        <LockClosed12Regular aria-hidden />
        Read on this computer only. Xomoni opens account.js, tweets.js and like.js; photos, videos and messages are
        never read.
      </Caption1>
    </div>
  );
}
