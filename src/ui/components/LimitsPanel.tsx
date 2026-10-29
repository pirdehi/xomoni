import { useLiveQuery } from 'dexie-react-hooks';
import { Gauge } from 'lucide-react';
import { db, getSettings } from '../../shared/db';
import { ACTION_LABELS } from '../../shared/settings';
import { DAY, HOUR } from '../../shared/time';
import type { ActionKind } from '../../shared/types';
import { fmtDuration, fmtNumber } from '../format';
import { Card, Meter, useNow } from './ui';

const SHOWN: ActionKind[] = ['delete', 'unretweet', 'unlike', 'relike'];
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

export function LimitsPanel({ accountId }: { accountId: string }) {
  const now = useNow(1000);
  const settings = useLiveQuery(getSettings, []);
  const usage = useLiveQuery(async () => {
    const since = Date.now() - DAY;
    const rows = await db.logs.where('[accountId+ts]').between([accountId, since], [accountId, Infinity]).toArray();
    const out: Record<string, { hour: number; day: number }> = {};
    for (const r of rows) {
      if (r.outcome !== 'done') continue;
      const u = (out[r.action] ??= { hour: 0, day: 0 });
      u.day++;
      if (r.ts > Date.now() - HOUR) u.hour++;
    }
    return out;
  }, [accountId]);
  const observed = useLiveQuery(
    () => db.limits.where('accountId').equals(accountId).filter((o) => o.at > Date.now() - 2 * HOUR).toArray(),
    [accountId],
  );

  return (
    <Card title="Limits & pacing" subtitle={settings ? `Preset: ${settings.preset[0].toUpperCase()}${settings.preset.slice(1)} · rolling windows` : undefined}>
      <div className="space-y-4">
        {SHOWN.map((action) => {
          const rule = settings?.pacing[action];
          const u = usage?.[action] ?? { hour: 0, day: 0 };
          if (!rule) return null;
          return (
            <div key={action}>
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="font-medium text-ink">{ACTION_LABELS[action]}</span>
                <span className="tabular text-ink-2">
                  {fmtNumber(u.hour)}/{fmtNumber(rule.hourlyCap)} hr · {fmtNumber(u.day)}/{fmtNumber(rule.dailyCap)} day
                </span>
              </div>
              <Meter value={u.day} max={rule.dailyCap} label={`${ACTION_LABELS[action]} today`} />
            </div>
          );
        })}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
          <Gauge size={13} className="text-muted" /> Reported by X (15-min windows)
        </div>
        {!observed?.length ? (
          <p className="text-xs text-muted">Nothing observed yet. X reports its limits as you use it; they appear here.</p>
        ) : (
          <ul className="space-y-1.5">
            {observed
              .sort((a, b) => a.op.localeCompare(b.op))
              .map((o) => {
                const resetIn = o.reset ? o.reset - now : null;
                const low = o.status === 429 || (o.remaining != null && o.limit != null && o.remaining <= Math.max(1, o.limit * 0.1));
                return (
                  <li key={o.key} className="tabular flex items-center justify-between text-xs">
                    <span className="text-ink-2">{OP_LABEL[o.op] ?? o.op}</span>
                    <span className={low ? 'font-medium text-critical' : 'text-ink'}>
                      {o.status === 429 ? 'limited' : `${o.remaining ?? '?'} / ${o.limit ?? '?'} left`}
                      {resetIn != null && resetIn > 0 && <span className="ml-2 text-muted">resets in {fmtDuration(resetIn)}</span>}
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
