import { useEffect, useRef } from 'react';
import { notify } from '../../shared/notify';
import type { Account } from '../../shared/types';
import { type ShowNotification, remindIfDue } from '../../shared/vault/freshness';

/**
 * The vault's local reminder while the dashboard is open (#425, ADR-0043, decision 9): every `everyMs` (an hour), and
 * once a few seconds after it opens, it reminds the person when one of X's files is due for a fresh copy, at most once a
 * day per account and only within active hours (`remindIfDue`). It shows nothing on the page, starts nothing, opens no
 * X page and sends nothing.
 */
export function VaultFollowUp({
  account,
  everyMs = 3_600_000,
  show = notify,
}: {
  account: Pick<Account, 'id' | 'handle'>;
  everyMs?: number;
  show?: ShowNotification;
}) {
  const checking = useRef(false);
  const { id, handle } = account;
  useEffect(() => {
    const check = () => {
      if (checking.current) return;
      checking.current = true;
      void remindIfDue({ id, handle }, Date.now(), show)
        .catch(() => {})
        .finally(() => (checking.current = false));
    };
    const first = setTimeout(check, Math.min(everyMs, 5_000));
    const timer = setInterval(check, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [id, handle, everyMs, show]);
  return null;
}
