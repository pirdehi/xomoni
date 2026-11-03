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
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { Delete20Regular } from '@fluentui/react-icons';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ROUTES } from '../domain/routes';
import { deleteAccount } from '../server/actions';
import { TextField } from './fields';

/** Signs out, then opens the sign-in page, which returns to the account page afterwards. */
const SIGN_IN_AGAIN = `${ROUTES.signOut}?next=${encodeURIComponent(`${ROUTES.signIn}?next=${ROUTES.account}`)}`;

/** The word the person types to confirm, exactly. */
const CONFIRM_WORD = 'DELETE';

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalXXL,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  title: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  text: {
    maxWidth: '672px',
    margin: 0,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  danger: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': { backgroundColor: tokens.colorStatusDangerForeground1, color: tokens.colorNeutralForegroundOnBrand },
    ':hover:active': {
      backgroundColor: tokens.colorStatusDangerForeground1,
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
  error: { margin: 0, color: tokens.colorStatusDangerForeground1, fontSize: tokens.fontSizeBase300 },
  dialogText: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  plain: { margin: 0 },
});

/**
 * The "Delete account" section: a dialog asks the person to type DELETE, then the Xomoni account is removed. If
 * the last sign-in is older than 10 minutes, the database refuses (#80) and the section offers to sign in again.
 */
export function DeleteAccountSection() {
  const s = useStyles();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const confirmed = typed === CONFIRM_WORD;
  const surface = useRef<HTMLDivElement>(null);

  // The field takes the focus once Fluent has run its own first-focus step, which happens in the dialog's effects.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => surface.current?.querySelector<HTMLInputElement>('input[name="confirm"]')?.focus());
    return () => clearTimeout(timer);
  }, [open]);

  function onDelete() {
    if (!confirmed) return;
    setOpen(false);
    setTyped('');
    startTransition(async () => {
      const result = await deleteAccount();
      if (result.error) setError(result.error);
      setReauthenticate(!!result.reauthenticate);
    });
  }

  return (
    <section className={s.section} aria-labelledby="danger-title">
      <h2 id="danger-title" className={s.title}>
        Delete account
      </h2>
      <p className={s.text}>
        Removes your Xomoni account, connected browsers and job history from our servers. Your X account and everything
        stored in the extension stay as they are.
      </p>
      <Dialog
        open={open}
        onOpenChange={(_, data) => {
          setOpen(data.open);
          setTyped('');
        }}
      >
        <DialogTrigger disableButtonEnhancement>
          <Button
            className={mergeClasses(!pending && s.danger)}
            icon={<Delete20Regular />}
            disabled={pending}
            data-variant="danger"
          >
            {pending ? 'Deleting…' : 'Delete my Xomoni account'}
          </Button>
        </DialogTrigger>
        <DialogSurface ref={surface}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onDelete();
            }}
          >
            <DialogBody>
              <DialogTitle>Delete your Xomoni account?</DialogTitle>
              <DialogContent className={s.dialogText}>
                <p className={s.plain}>
                  This deletes your Xomoni account: connected browsers and job history on this site. Nothing on X is
                  deleted, and the extension keeps working offline.
                </p>
                <TextField
                  label={`Type ${CONFIRM_WORD} to confirm`}
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
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {reauthenticate && (
        <form action={SIGN_IN_AGAIN} method="post">
          <Button type="submit">Sign in again</Button>
        </form>
      )}
    </section>
  );
}
