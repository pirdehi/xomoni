import { useEffect, useRef } from 'react';
import { reachNotificationId } from '../../shared/notification-ids';
import { notify } from '../../shared/notify';
import type { Account } from '../../shared/types';
import { type ShowAlert, notifyReachDrop } from '../../shared/vault/reach-alerts';

/**
 * Reach's drop notification while the dashboard is open (#430, P5.3.1): every `everyMs` (an hour), and once a few
 * seconds after it opens, it notifies the person when the last 7 days' views fell under 0.6 of the 8 weeks before,
 * only if they turned on *Tell me when my reach drops*, and at most once a week per account (`notifyReachDrop`). It
 * shows nothing on the page, starts nothing, opens no X page and sends nothing.
 */
export function ReachFollowUp({
  account,
  everyMs = 3_600_000,
  show = (id, title, message) => notify(id, title, message),
}: {
  account: Pick<Account, 'id' | 'handle'>;
  everyMs?: number;
  show?: ShowAlert;
}) {
  const checking = useRef(false);
  const { id, handle } = account;
  useEffect(() => {
    const check = () => {
      if (checking.current) return;
      checking.current = true;
      void notifyReachDrop({ id, handle }, Date.now(), reachNotificationId(id), show)
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
