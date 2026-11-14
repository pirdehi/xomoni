import {
  Avatar,
  Body1,
  Body1Strong,
  Caption1,
  Checkbox,
  Link,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CloudOff16Regular, Pause16Regular, PlugDisconnected16Regular, SignOut20Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useState, useSyncExternalStore } from 'react';
import { FORGOTTEN_HERE } from '../../cloud/sync';
import { db } from '../../shared/db';
import type { Account } from '../../shared/types';
import { downloadFile, errorMessage, toDateInput } from '../format';
import { toast } from '../hooks';
import { type SignOutChoice, accountCopy, signOut } from '../sign-out';
import { useConnection } from './CloudCard';
import { Button, Modal } from './ui';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  who: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  whoText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0 },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    listStyleType: 'none',
    color: tokens.colorNeutralForeground2,
  },
  itemIcon: { flexShrink: 0, marginTop: '2px', color: tokens.colorNeutralForeground3 },
  options: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  option: { display: 'flex', flexDirection: 'column' },
  // Lines the help text up with the checkbox's label, past the box itself.
  help: { marginLeft: '32px', marginTop: `-${tokens.spacingVerticalXS}`, color: tokens.colorNeutralForeground3 },
  noWrap: { whiteSpace: 'nowrap' },
});

let pending: Account | null = null;
const listeners = new Set<() => void>();

const show = (account: Account | null) => {
  pending = account;
  listeners.forEach((l) => l());
};

/** Opens the sign-out dialog for `account` (#226). The app shell renders it, so it outlives the account menu. */
export function openSignOut(account: Account) {
  show(account);
}

const close = () => show(null);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * The sign-out dialog (#226), rendered once by the app shell. It names the account and says what signing out does:
 * the running job pauses, this browser disconnects from xomoni.com, the X window closes and nothing more is recorded
 * from X. Two choices: remove the account's data from this browser (with a copy to download first), and also sign out
 * of X on X's own page. Pressing Sign out runs `signOut`; the page behind turns into the signed-out page.
 */
export function SignOutDialog() {
  const account = useSyncExternalStore(subscribe, () => pending);
  // A new key per opening starts the choices afresh.
  return account ? <SignOutForm key={account.id} account={account} /> : null;
}

function SignOutForm({ account }: { account: Account }) {
  const s = useStyles();
  const connection = useConnection();
  const job = useLiveQuery(
    () =>
      db.jobs
        .where('accountId')
        .equals(account.id)
        .filter((j) => j.state === 'running' || j.state === 'waiting')
        .first(),
    [account.id],
  );
  const [choice, setChoice] = useState<SignOutChoice>({ removeData: false, signOutOfX: false });
  const [busy, setBusy] = useState(false);
  const name = account.name || account.handle;

  const go = async () => {
    setBusy(true);
    try {
      const result = await signOut(account, choice);
      close();
      toast(`Signed out of Xomoni. @${account.handle} is no longer used in this browser.`, 'good');
      if (result.cloud === 'forgotten-here') toast(FORGOTTEN_HERE, 'critical');
      if (choice.removeData && !result.stopped)
        toast(`A job was still finishing, so @${account.handle}’s data stayed in this browser.`, 'critical');
    } catch (err) {
      setBusy(false);
      toast(`Couldn’t finish signing out: ${errorMessage(err)}`, 'critical');
    }
  };

  const downloadCopy = async () => {
    try {
      downloadFile(
        `xomoni-${account.handle || 'account'}-${toDateInput(Date.now())}.json`,
        await accountCopy(account.id),
      );
    } catch (err) {
      toast(errorMessage(err), 'critical');
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && close()}
      title="Sign out of Xomoni?"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            variant={choice.removeData ? 'danger' : 'primary'}
            className={s.noWrap}
            disabled={busy}
            icon={busy ? <Spinner size="extra-tiny" aria-hidden /> : <SignOut20Regular />}
            onClick={() => void go()}
            data-autofocus
          >
            {busy ? 'Signing out…' : choice.removeData ? 'Sign out and remove data' : 'Sign out'}
          </Button>
        </>
      }
    >
      <div className={s.body}>
        <div className={s.who}>
          <Avatar
            aria-hidden
            size={36}
            image={account.avatar ? { src: account.avatar } : undefined}
            initials={account.avatar ? undefined : (name || '?').slice(0, 1).toUpperCase()}
          />
          <div className={s.whoText}>
            <Body1Strong>{name}</Body1Strong>
            <Caption1 className={s.muted}>@{account.handle} on X</Caption1>
          </div>
        </div>

        <ul className={s.list} aria-label="What signing out does">
          {job && (
            <Effect icon={<Pause16Regular />}>
              “{job.title}” pauses. It continues where it stopped when you sign in again.
            </Effect>
          )}
          {connection && (
            <Effect icon={<CloudOff16Regular />}>
              This browser disconnects from xomoni.com
              {connection.account ? ` (${connection.account})` : ''}, so it stops sending job status.
            </Effect>
          )}
          <Effect icon={<PlugDisconnected16Regular />}>
            The X window Xomoni opened closes, and Xomoni stops recording what X shows until you sign in again.
          </Effect>
        </ul>

        <div className={s.options} role="group" aria-label="Also">
          <div className={s.option}>
            <Checkbox
              checked={choice.removeData}
              disabled={busy}
              onChange={(_, data) => setChoice((c) => ({ ...c, removeData: data.checked === true }))}
              label={`Remove @${account.handle}’s data from this browser`}
            />
            <Caption1 as="p" className={s.help}>
              The inventory, archive, jobs, Watch and activity log. Xomoni keeps its record of X’s limits, so they still
              hold.{' '}
              <Link as="button" inline onClick={() => void downloadCopy()} disabled={busy}>
                Download a copy first
              </Link>
            </Caption1>
          </div>
          <div className={s.option}>
            <Checkbox
              checked={choice.signOutOfX}
              disabled={busy}
              onChange={(_, data) => setChoice((c) => ({ ...c, signOutOfX: data.checked === true }))}
              label="Also sign out of X"
            />
            <Caption1 as="p" className={s.help}>
              Opens X’s own sign-out page, where X asks you to confirm. Xomoni never sees your X password.
            </Caption1>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** One thing signing out does, with its icon. */
function Effect({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  const s = useStyles();
  return (
    <li className={s.item}>
      <span className={s.itemIcon} aria-hidden>
        {icon}
      </span>
      <Body1>{children}</Body1>
    </li>
  );
}
