import { Body1, Caption1, Switch, makeStyles, tokens } from '@fluentui/react-components';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import {
  REACH_DROP_MIN_POSTS,
  accountReachDrop,
  reachDropAlertsOn,
  setReachDropAlerts,
} from '../../../shared/vault/reach-alerts';
import { fmtNumber } from '../../format';
import { Badge, Card } from '../ui';
import { PlusBadge } from './PlusBadge';

const useStyles = makeStyles({
  stack: { display: 'grid', gap: tokens.spacingVerticalS },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
});

/**
 * The note on Reach when the last 7 days' views fell under 0.6 of the 8 weeks before (#430, P5.3.1): how far, from
 * the daily numbers (an estimate), what may go with it, never why; and *Tell me when my reach drops*, off unless the
 * person turns it on. Shows nothing without a drop, without numbers enough, or with fewer than 5 recent posts.
 */
export function ReachDropNote({ accountId }: { accountId: string }) {
  const styles = useStyles();
  // The page counts from the minute it opened; the note isn't a clock.
  const [now] = useState(() => Date.now());
  const drop = useLiveQuery(async () => await accountReachDrop(accountId, now), [accountId, now]);
  const alertsOn = useLiveQuery(async () => await reachDropAlertsOn(accountId), [accountId]);
  // Reach's alerts are part of Plus, open as a preview until sales start (ADR-0042).
  const toggle = (
    <div className={styles.row}>
      <Switch
        label="Tell me when my reach drops"
        checked={alertsOn === true}
        onChange={(_, data) => void setReachDropAlerts(accountId, data.checked)}
      />
      <PlusBadge feature="reach-alerts" />
    </div>
  );
  if (!drop)
    return (
      <Card
        title="When your reach drops"
        subtitle="Xomoni compares your last 7 days with the 8 weeks before, from your daily numbers, while the dashboard is open."
      >
        {toggle}
      </Card>
    );
  return (
    <Card
      title="Your views fell this week"
      subtitle="From your daily numbers: an estimate, not X's own count of each post."
    >
      <div className={styles.stack}>
        <Body1>
          About {fmtNumber(Math.round(drop.recent))} views a day over the last 7 days, against{' '}
          {fmtNumber(Math.round(drop.usual))} a day over the 8 weeks before: {Math.round(drop.ratio * 100)}% of your
          usual. <Badge tone="neutral">Estimate</Badge>
        </Body1>
        <Caption1>What may go with it, not why:</Caption1>
        <ul className={styles.list}>
          <li>Fewer posts, or posts at other times of day than usual (at least {REACH_DROP_MIN_POSTS} are counted).</li>
          <li>More posts with a link out of X; the comparisons below show how links go with your reach.</li>
          <li>A label X applied: its Under the hood report for this month, once it is out, says so.</li>
        </ul>
        {toggle}
      </div>
    </Card>
  );
}
