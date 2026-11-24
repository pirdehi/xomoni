import { Input, makeStyles, tokens } from '@fluentui/react-components';
import { type SyntheticEvent, useId, useState } from 'react';
import { addAccountEvent } from '../../../shared/vault/db';
import type { Account } from '../../../shared/types';
import { errorMessage, fmtDate, toDateInput } from '../../format';
import { toast } from '../../hooks';
import { Button, Field, Modal } from '../ui';

const useStyles = makeStyles({
  error: { margin: 0, color: tokens.colorPaletteRedForeground1 },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

/** The words the timeline keeps for a date of Premium the person gave. */
export const PREMIUM_SAID_WORDS = 'X Premium on, from the date you gave.';

/**
 * Why `day` (`YYYY-MM-DD`, from a date field) can't be the day the account got Premium at `now`, or null when it can:
 * not a date, after today, or before the X account was made (when Xomoni knows when).
 */
export function premiumDayProblem(day: string, account: Pick<Account, 'createdAt'>, now = Date.now()): string | null {
  const [y, m, d] = day.split('-').map(Number);
  const at = y && m && d ? new Date(y, m - 1, d, 12).getTime() : Number.NaN;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(at) || toDateInput(at) !== day)
    return 'Pick the day you got X Premium.';
  if (day > toDateInput(now)) return 'That day is still to come. Pick the day you got X Premium.';
  if (account.createdAt !== null && day < toDateInput(account.createdAt))
    return `That is before your X account was made, on ${fmtDate(account.createdAt)}.`;
  return null;
}

/**
 * *When did you get Premium?* (#429, ADR-0045): the day the person got X Premium, for Reach's Premium comparison, when
 * Xomoni never saw the change on the profile. It goes on the account's timeline as the person's own entry
 * (`premium_on`, said by the person), where they can see it; nothing is sent anywhere.
 */
export function PremiumDateDialog({
  account,
  open,
  onClose,
}: {
  account: Pick<Account, 'id' | 'createdAt'>;
  open: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const [day, setDay] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Today, read once when the dialog is made: the latest day the field offers.
  const [today] = useState(() => toDateInput(Date.now()));
  const errorId = useId();

  const close = () => {
    setDay('');
    setProblem(null);
    onClose();
  };

  // Xomoni checks the day itself (`premiumDayProblem`), with words the person can act on, rather than the browser's.
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    const now = Date.now();
    const why = premiumDayProblem(day, account, now);
    setProblem(why);
    if (why) return;
    setSaving(true);
    try {
      const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
      await addAccountEvent({
        accountId: account.id,
        kind: 'premium_on',
        at: Math.min(new Date(y, m - 1, d, 12).getTime(), now),
        source: 'person',
        words: PREMIUM_SAID_WORDS,
      });
      toast('Saved on your timeline. Reach compares from that day.', 'good');
      close();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="When did you get Premium?"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="premium-date" disabled={saving}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="premium-date"
        noValidate
        className={styles.form}
        aria-label="When did you get Premium?"
        onSubmit={(e) => void save(e)}
      >
        <p>
          Reach compares your posts in the 8 weeks after with the 8 weeks before. The day goes on your account&apos;s
          timeline, and stays on this computer.
        </p>
        <Field label="The day you got X Premium">
          <Input
            type="date"
            value={day}
            max={today}
            onChange={(_, data) => setDay(data.value)}
            aria-invalid={problem !== null}
            aria-describedby={problem ? errorId : undefined}
            data-autofocus
          />
        </Field>
        {problem && (
          <p id={errorId} role="alert" className={styles.error}>
            {problem}
          </p>
        )}
      </form>
    </Modal>
  );
}
