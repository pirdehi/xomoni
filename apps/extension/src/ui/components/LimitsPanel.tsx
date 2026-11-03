import { Text, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Gauge16Regular, ShieldError16Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, getViewCap } from '../../shared/db';
import { RISK_LABELS } from '../../shared/risk';
import { ACTION_LABELS } from '../../shared/settings';
import { DAY, HOUR } from '../../shared/time';
import type { ActionKind } from '../../shared/types';
import { liveSlot, scaleRule, share } from '../../shared/x-limits';
import { fmtDuration, fmtNumber } from '../format';
import { usePace } from '../hooks';
import { Card, Meter, useNow } from './ui';

const SHOWN: ActionKind[] = ['delete', 'unretweet', 'unlike', 'relike', 'read'];
const OP_LABEL: Record<string, string> = {
  DeleteTweet: 'Delete post',
  DeleteRetweet: 'Undo repost',
  UnfavoriteTweet: 'Unlike',
  FavoriteTweet: 'Like',
  SearchTimeline: 'Search',
  UserTweets: 'Profile timeline',
  UserTweetsAndReplies: 'Replies timeline',
  Likes: 'Likes timeline',
  TweetDetail: 'Post page',
  UserByScreenName: 'Profile',
};

const useStyles = makeStyles({
  risk: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    backgroundColor: tokens.colorStatusWarningBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusWarningBorder1}`,
  },
  riskCritical: {
    backgroundColor: tokens.colorStatusDangerBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusDangerBorder1}`,
  },
  riskIcon: { flexShrink: 0, marginTop: '1px', color: tokens.colorStatusWarningForeground1 },
  riskIconCritical: { color: tokens.colorStatusDangerForeground1 },
  riskTitle: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  riskDetail: { marginTop: tokens.spacingVerticalXXS, color: tokens.colorNeutralForeground2 },
  actions: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  actionHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalSNudge,
  },
  label: { color: tokens.colorNeutralForeground1 },
  numbers: { color: tokens.colorNeutralForeground2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  note: {
    display: 'block',
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
  },
  observed: {
    marginTop: tokens.spacingVerticalXL,
    paddingTop: tokens.spacingVerticalL,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  observedTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalSNudge,
    margin: `0 0 ${tokens.spacingVerticalS}`,
    color: tokens.colorNeutralForeground1,
  },
  observedIcon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  empty: { display: 'block', margin: 0, color: tokens.colorNeutralForeground3 },
  list: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalSNudge,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    fontVariantNumeric: 'tabular-nums',
  },
  op: { flexShrink: 0, whiteSpace: 'nowrap', color: tokens.colorNeutralForeground2 },
  value: { minWidth: 0, textAlign: 'right', color: tokens.colorNeutralForeground1 },
  valueCritical: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorStatusDangerForeground1 },
  reset: {
    display: 'inline-block',
    marginLeft: tokens.spacingHorizontalS,
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
  },
});

/**
 * Usage against Xomoni's hourly and daily caps (one fifth of X's limits), counted from `done` log entries and
 * page loads (`reads`) of the last 24 hours, and the 15-minute quotas X reported in the last 2 hours
 * (the `limits` table), with the point where Xomoni stops: one fifth of each. A risk level above 0 shows as a
 * `status` note (`data-tone`: `warn`, or `critical` from level 3); a quota Xomoni is waiting on is marked
 * `data-tone="critical"`.
 */
export function LimitsPanel({ accountId }: { accountId: string }) {
  const styles = useStyles();
  const now = useNow(1000);
  const settings = useLiveQuery(getSettings, []);
  const pace = usePace(accountId);
  // Counts re-run every minute as well as on new rows, so actions age out of the last hour and day while idle.
  const minute = Math.floor(now / 60_000);
  const counts = useLiveQuery(async () => {
    const since = Date.now() - DAY;
    const [rows, reads] = await Promise.all([
      db.logs.where('[accountId+ts]').between([accountId, since], [accountId, Infinity]).toArray(),
      db.reads.where('[accountId+ts]').between([accountId, since], [accountId, Infinity]).toArray(),
    ]);
    const out: Partial<Record<string, { hour: number; day: number }>> = {};
    let postsSeen = 0;
    for (const r of reads) {
      const u = (out.read ??= { hour: 0, day: 0 });
      u.day++;
      if (r.ts > Date.now() - HOUR) u.hour++;
      postsSeen += r.posts ?? 0;
    }
    for (const r of rows) {
      if (r.outcome !== 'done' || r.action === 'read') continue;
      const u = (out[r.action] ??= { hour: 0, day: 0 });
      u.day++;
      if (r.ts > Date.now() - HOUR) u.hour++;
    }
    return { byAction: out, postsSeen };
  }, [accountId, minute]);
  const viewCap = useLiveQuery(() => getViewCap(accountId), [accountId]);
  const usage = pace && counts ? { ...pace, counts: counts.byAction } : undefined;
  const observed = useLiveQuery(
    () =>
      db.limits
        .where('accountId')
        .equals(accountId)
        .filter((o) => o.at > Date.now() - 2 * HOUR)
        .toArray(),
    [accountId],
  );
  const serious = !!usage && usage.risk.level >= 3;

  return (
    <Card
      title="Limits & pacing"
      subtitle={
        settings
          ? `Preset: ${settings.preset.charAt(0).toUpperCase()}${settings.preset.slice(1)} · at most ⅕ of X's limits` +
            (usage && usage.step.factor < 1 ? ` · warm-up day ${usage.step.day} of ${usage.step.days}` : '') +
            (usage && usage.factor < 1 ? ` · running at ${Math.round(usage.factor * 100)}% of that` : '') +
            (usage && usage.reads < 1 ? ' · page loads at half: the account is not known to be Premium' : '')
          : undefined
      }
    >
      {usage && usage.risk.level > 0 && (
        <div
          role="status"
          className={mergeClasses(styles.risk, serious && styles.riskCritical)}
          data-tone={serious ? 'critical' : 'warn'}
        >
          <ShieldError16Regular
            className={mergeClasses(styles.riskIcon, serious && styles.riskIconCritical)}
            aria-hidden
          />
          <div>
            <div className={styles.riskTitle}>
              Risk level {usage.risk.level}: {RISK_LABELS[usage.risk.level]}
            </div>
            <div className={styles.riskDetail}>
              {usage.risk.reason}.
              {usage.risk.fullStop
                ? ' Xomoni won’t resume on its own.'
                : usage.risk.resumeAt
                  ? ` Resume opens in ${fmtDuration(usage.risk.resumeAt - now)}.`
                  : ''}
              {usage.risk.reducedUntil && !usage.risk.fullStop
                ? ` Slower pace for ${fmtDuration(usage.risk.reducedUntil - now)} more.`
                : ''}
            </div>
          </div>
        </div>
      )}
      <div className={styles.actions}>
        {SHOWN.map((action) => {
          const stored = settings?.pacing[action];
          const u = usage?.counts[action] ?? { hour: 0, day: 0 };
          if (!stored) return null;
          // The caps in force now: smaller during warm-up and on the risk ladder, never above one fifth.
          const factor = (usage?.factor ?? 1) * (action === 'read' ? (usage?.reads ?? 1) : 1);
          const rule = scaleRule(stored, factor);
          return (
            <div key={action}>
              <div className={styles.actionHead}>
                <Text size={200} weight="semibold" className={styles.label}>
                  {ACTION_LABELS[action]}
                </Text>
                <Text size={200} className={styles.numbers}>
                  {fmtNumber(u.hour)}/{fmtNumber(rule.hourlyCap)} hr · {fmtNumber(u.day)}/{fmtNumber(rule.dailyCap)} day
                </Text>
              </div>
              <Meter value={u.day} max={rule.dailyCap} label={`${ACTION_LABELS[action]} today`} />
              {action === 'read' && (
                <Text as="p" size={200} className={styles.note}>
                  {fmtNumber(counts?.postsSeen ?? 0)} posts seen in the last 24 hours
                  {viewCap &&
                    ` · stops at ${fmtNumber(viewCap.cap)} a day: the view cap learned when X refused pages after ${fmtNumber(viewCap.seen)}`}
                </Text>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.observed}>
        <Text as="p" size={200} weight="semibold" className={styles.observedTitle}>
          <Gauge16Regular className={styles.observedIcon} aria-hidden /> Reported by X (15-min windows) · Xomoni stops
          at one fifth
        </Text>
        {!observed?.length ? (
          <Text as="p" size={200} className={styles.empty}>
            Nothing observed yet. X reports its limits as you use it; they appear here.
          </Text>
        ) : (
          <ul className={styles.list}>
            {observed
              .sort((a, b) => a.op.localeCompare(b.op))
              .map((o) => {
                const resetIn = o.reset ? o.reset - now : null;
                // Xomoni is waiting on this operation once one fifth of X's window is used.
                const low = liveSlot(o, now) > now;
                const used = o.limit != null && o.remaining != null ? o.limit - o.remaining : null;
                return (
                  <li key={o.key} className={styles.row}>
                    <span className={styles.op}>{OP_LABEL[o.op] ?? o.op}</span>
                    <span
                      className={mergeClasses(styles.value, low && styles.valueCritical)}
                      data-tone={low ? 'critical' : 'neutral'}
                    >
                      {o.status === 429
                        ? 'limited'
                        : used != null && o.limit != null
                          ? `${used} used · stops at ${share(o.limit)} of ${o.limit}`
                          : 'no live limit reported'}
                      {resetIn != null && resetIn > 0 && (
                        <span className={styles.reset}>resets in {fmtDuration(resetIn)}</span>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </Card>
  );
}
