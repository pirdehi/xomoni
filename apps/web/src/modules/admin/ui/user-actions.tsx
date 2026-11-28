'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  MessageBar,
  MessageBarBody,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  PersonAvailable20Regular,
  PersonDelete20Regular,
  PersonProhibited20Regular,
  SignOut20Regular,
} from '@fluentui/react-icons';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { TextField } from '@/modules/auth/ui/fields';
import { deleteUserAccount, setUserSuspended, signOutUserEverywhere, type ConsoleActionState } from '../server/actions';
import { actionsWithheld, type UserDetail } from '../domain/users';

const useStyles = makeStyles({
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  danger: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': { backgroundColor: tokens.colorStatusDangerForeground1, color: tokens.colorNeutralForegroundOnBrand },
    ':hover:active': {
      backgroundColor: tokens.colorStatusDangerForeground1,
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
  plain: { margin: 0 },
  muted: { margin: 0, color: tokens.colorNeutralForeground3 },
});

/** Why no action is offered, in words. */
const WITHHELD = {
  self: 'This is your own account: the console takes no action on it. Use your account page instead.',
  superadmin: 'This account is a super-admin: the console takes no action on another super-admin’s account.',
} as const;

/**
 * What a super-admin can do to an account (#516): sign it out everywhere, suspend or restore it, and delete it after
 * typing its email exactly. Each action runs on the server, which checks again that the caller is a super-admin, and
 * the database records it in the audit log. Nothing is offered on one's own account or another super-admin's.
 */
export function UserActions({
  user,
  viewerId,
}: {
  user: Pick<UserDetail, 'id' | 'email' | 'banned' | 'superadmin'>;
  viewerId: string;
}) {
  const s = useStyles();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConsoleActionState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim() === user.email && user.email !== '';

  const withheld = actionsWithheld(viewerId, user);
  if (withheld) return <p className={s.muted}>{WITHHELD[withheld]}</p>;

  function run(action: () => Promise<ConsoleActionState>) {
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (!outcome.error) router.refresh();
    });
  }

  return (
    <div className={s.stack}>
      <div className={s.actions}>
        <Button
          icon={<SignOut20Regular />}
          disabled={pending}
          onClick={() => run(() => signOutUserEverywhere(user.id))}
        >
          Sign out everywhere
        </Button>
        {user.banned ? (
          <Button
            icon={<PersonAvailable20Regular />}
            disabled={pending}
            onClick={() => run(() => setUserSuspended(user.id, false))}
          >
            Restore
          </Button>
        ) : (
          <Button
            icon={<PersonProhibited20Regular />}
            disabled={pending}
            onClick={() => run(() => setUserSuspended(user.id, true))}
          >
            Suspend
          </Button>
        )}
        <Dialog
          open={deleting}
          onOpenChange={(_, data) => {
            setDeleting(data.open);
            setTyped('');
          }}
        >
          <DialogTrigger disableButtonEnhancement>
            <Button icon={<PersonDelete20Regular />} disabled={pending} className={s.danger} data-variant="danger">
              Delete account
            </Button>
          </DialogTrigger>
          <DialogSurface>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!confirmed) return;
                setDeleting(false);
                const email = typed.trim();
                setTyped('');
                run(() => deleteUserAccount(user.id, email));
              }}
            >
              <DialogBody>
                <DialogTitle>Delete this account?</DialogTitle>
                <DialogContent className={s.stack}>
                  <p className={s.plain}>
                    This deletes the Xomoni account {user.email}: its connected browsers, job history and choices. It
                    can’t be undone. Nothing on X is touched.
                  </p>
                  <TextField
                    label="Type the account’s email to confirm"
                    name="confirm"
                    autoComplete="off"
                    spellCheck={false}
                    onInput={(event) => setTyped(event.currentTarget.value)}
                  />
                </DialogContent>
                <DialogActions>
                  <DialogTrigger disableButtonEnhancement>
                    <Button>Cancel</Button>
                  </DialogTrigger>
                  <Button
                    type="submit"
                    appearance="primary"
                    className={mergeClasses(confirmed && s.danger)}
                    disabled={!confirmed}
                    data-variant="danger"
                  >
                    Delete account
                  </Button>
                </DialogActions>
              </DialogBody>
            </form>
          </DialogSurface>
        </Dialog>
      </div>
      {pending && (
        <p className={s.muted} role="status">
          Working…
        </p>
      )}
      {result?.error && (
        <MessageBar intent="error" role="alert" aria-labelledby={undefined}>
          <MessageBarBody>{result.error}</MessageBarBody>
        </MessageBar>
      )}
      {result?.done && (
        <MessageBar intent="success" role="status" aria-labelledby={undefined}>
          <MessageBarBody>{result.done}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}
