import { useLiveQuery } from 'dexie-react-hooks';
import { Gauge } from 'lucide-react';
import { db, getSettings, getViewCap } from '../../shared/db';
import { RISK_LABELS } from '../../shared/risk';
import { ACTION_LABELS } from '../../shared/settings';
import { DAY, HOUR } from '../../shared/time';
import type { ActionKind } from '../../shared/types';
import { liveSlot, scaleRule, share } from '../../shared/x-limits';
import { fmtDuration, fmtNumber } from '../format';
import { usePace } from '../hooks';
import { Card, Meter, cx, useNow } from './ui';

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

/**
 * Usage against Xomoni's hourly and daily caps (one fifth of X's limits), counted from `done` log entries and
 * page loads (`reads`) of the last 24 hours, and the 15-minute quotas X reported in the last 2 hours
 * (the `limits` table), with the point where Xomoni stops: one fifth of each.
 */
export function LimitsPanel({ accountId }: { accountId: string }) {
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
          className={cx(
            'mb-4 rounded-lg border px-3 py-2 text-xs',
            usage.risk.level >= 3 ? 'border-critical/40 bg-critical/10' : 'border-warn/40 bg-warn/10',
          )}
        >
          <div className="font-medium text-ink">
            Risk level {usage.risk.level}: {RISK_LABELS[usage.risk.level]}
          </div>
          <div className="mt-0.5 text-ink-2">
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
      )}
      <div className="space-y-4">
        {SHOWN.map((action) => {
          const stored = settings?.pacing[action];
          const u = usage?.counts[action] ?? { hour: 0, day: 0 };
          if (!stored) return null;
          // The caps in force now: smaller during warm-up and on the risk ladder, never above one fifth.
          const factor = (usage?.factor ?? 1) * (action === 'read' ? (usage?.reads ?? 1) : 1);
          const rule = scaleRule(stored, factor);
          return (
            <div key={action}>
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="font-medium text-ink">{ACTION_LABELS[action]}</span>
                <span className="tabular text-ink-2">
                  {fmtNumber(u.hour)}/{fmtNumber(rule.hourlyCap)} hr · {fmtNumber(u.day)}/{fmtNumber(rule.dailyCap)} day
                </span>
              </div>
              <Meter value={u.day} max={rule.dailyCap} label={`${ACTION_LABELS[action]} today`} />
              {action === 'read' && (
                <p className="mt-1 text-[11px] text-muted">
                  {fmtNumber(counts?.postsSeen ?? 0)} posts seen in the last 24 hours
                  {viewCap &&
                    ` · stops at ${fmtNumber(viewCap.cap)} a day: the view cap learned when X refused pages after ${fmtNumber(viewCap.seen)}`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
          <Gauge size={13} className="text-muted" /> Reported by X (15-min windows) · Xomoni stops at one fifth
        </div>
        {!observed?.length ? (
          <p className="text-xs text-muted">
            Nothing observed yet. X reports its limits as you use it; they appear here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {observed
              .sort((a, b) => a.op.localeCompare(b.op))
              .map((o) => {
                const resetIn = o.reset ? o.reset - now : null;
                // Xomoni is waiting on this operation once one fifth of X's window is used.
                const low = liveSlot(o, now) > now;
                const used = o.limit != null && o.remaining != null ? o.limit - o.remaining : null;
                return (
                  <li key={o.key} className="tabular flex items-center justify-between text-xs">
                    <span className="text-ink-2">{OP_LABEL[o.op] ?? o.op}</span>
                    <span className={low ? 'font-medium text-critical' : 'text-ink'}>
                      {o.status === 429
                        ? 'limited'
                        : used != null && o.limit != null
                          ? `${used} used · stops at ${share(o.limit)} of ${o.limit}`
                          : 'no live limit reported'}
                      {resetIn != null && resetIn > 0 && (
                        <span className="ml-2 text-muted">resets in {fmtDuration(resetIn)}</span>
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
