import { useLiveQuery } from 'dexie-react-hooks';
import {
  CalendarClock,
  Download,
  Heart,
  Info,
  MessageSquareReply,
  Repeat2,
  ShieldCheck,
  SquarePen,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { createCleanupJob } from '../../engine/runner';
import { archiveImported, getSettings } from '../../shared/db';
import { actionFor, estimateDuration, findCandidates, normalizeKeywords, parseIdList } from '../../shared/filter';
import { DAY } from '../../shared/time';
import type { CleanupFilter, CleanupOptions, CleanupTarget } from '../../shared/types';
import type { PageProps } from '../navigation';
import { Button, Callout, Card, Field, Modal, PageHeader, Segmented, Toggle, cx } from '../components/ui';
import {
  TARGET_PLURAL,
  downloadFile,
  errorMessage,
  fmtDate,
  fmtDuration,
  fmtNumber,
  fromDateInput,
  toDateInput,
} from '../format';
import { startJob, toast, useRunner } from '../hooks';
import { useKindCounts } from '../queries';

type Age = '30d' | '90d' | '6m' | '1y' | '2y' | 'custom';

const AGES: { value: Age; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
  { value: 'custom', label: 'Pick a date' },
];

/** How far back each preset age reaches, in days. */
const AGE_DAYS: Record<Exclude<Age, 'custom'>, number> = { '30d': 30, '90d': 90, '6m': 182, '1y': 365, '2y': 730 };

const TARGETS: { value: CleanupTarget; label: string; icon: ReactNode }[] = [
  { value: 'post', label: 'Posts', icon: <SquarePen size={16} /> },
  { value: 'reply', label: 'Replies', icon: <MessageSquareReply size={16} /> },
  { value: 'repost', label: 'Reposts', icon: <Repeat2 size={16} /> },
  { value: 'like', label: 'Likes', icon: <Heart size={16} /> },
];

/** The verb a job title uses for each target. */
const VERB: Record<CleanupTarget, string> = { post: 'Delete', reply: 'Delete', repost: 'Undo', like: 'Remove' };

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();

/**
 * Builds a cleanup filter (what, older than when, what to keep, how to find it), previews the
 * matching inventory items with a time estimate from the current pacing, and offers a JSON backup.
 * Without an imported archive it warns that old posts can be missed (PLAYBOOK E2) and starts only once the
 * person acknowledges it. The job is created and started only after the user types DELETE in the
 * confirmation dialog.
 */
export function CleanupPage({ account, navigate }: PageProps) {
  const counts = useKindCounts(account.id);
  const settings = useLiveQuery(getSettings, []);
  const run = useRunner();

  // Latest date the custom picker allows; fixed for the life of the page.
  const [today] = useState(() => toDateInput(Date.now()));
  const [target, setTarget] = useState<CleanupTarget>('post');
  const [age, setAge] = useState<Age>('1y');
  const [customDate, setCustomDate] = useState(toDateInput(startOfToday() - 365 * DAY));
  const [useAfter, setUseAfter] = useState(false);
  const [afterDate, setAfterDate] = useState(toDateInput(startOfToday() - 5 * 365 * DAY));
  const [minLikes, setMinLikes] = useState('');
  const [keywords, setKeywords] = useState('');
  const [ids, setIds] = useState('');
  const [skipSelfReplies, setSkipSelfReplies] = useState(true);
  const [options, setOptions] = useState<CleanupOptions>({ sweep: true, deep: true, ghostLikes: false });
  const [confirming, setConfirming] = useState(false);
  const hasArchive = useLiveQuery(() => archiveImported(account.id), [account.id]);
  const [missAcknowledged, setMissAcknowledged] = useState(false);

  // A date the person cleared or mistyped never falls back to "today", which would match everything: it matches
  // nothing and keeps Start off until the dates make sense.
  const pickedBefore = age === 'custom' ? fromDateInput(customDate) : startOfToday() - AGE_DAYS[age] * DAY;
  const pickedAfter = useAfter ? fromDateInput(afterDate) : null;
  const dateProblem =
    pickedBefore == null
      ? 'Pick the date to clean up before.'
      : useAfter && pickedAfter == null
        ? 'Pick the start date of the range, or turn the range off.'
        : pickedAfter != null && pickedAfter >= pickedBefore
          ? 'The start date must be before the end date.'
          : null;
  const before = pickedBefore ?? 0;
  const filter: CleanupFilter = useMemo(
    () => ({
      target,
      before,
      after: pickedAfter,
      keepMinLikes: minLikes.trim() && Number(minLikes) > 0 ? Number(minLikes) : null,
      keepKeywords: normalizeKeywords(keywords),
      keepIds: parseIdList(ids),
      skipSelfReplies,
    }),
    [target, before, pickedAfter, minLikes, keywords, ids, skipSelfReplies],
  );
  const filterKey = JSON.stringify(filter);
  const candidates = useLiveQuery(() => findCandidates(account.id, filter), [account.id, filterKey]);

  const action = actionFor(target, options.ghostLikes);
  const rule = settings?.pacing[action];
  const eta = rule && candidates ? estimateDuration(candidates.length, rule) : 0;
  const days = rule && candidates ? Math.ceil(candidates.length / rule.dailyCap) : 0;
  const title = `${VERB[target]} ${TARGET_PLURAL[target]} older than ${fmtDate(before)}`;
  // Reposts gain little from the archive: it doesn't say which post a repost points to.
  const needsArchive = hasArchive === false && target !== 'repost';
  const canStart =
    // Until the archive check has answered, the page can't tell whether the warning applies.
    hasArchive !== undefined &&
    dateProblem == null &&
    run.status === 'idle' &&
    (options.sweep || options.deep) &&
    (!!candidates?.length || options.sweep) &&
    (!needsArchive || missAcknowledged);

  const backup = () => {
    if (!candidates?.length) return;
    downloadFile(
      `xomoni-backup-${TARGET_PLURAL[target]}-${toDateInput(Date.now())}.json`,
      JSON.stringify(candidates, null, 2),
    );
    toast(`Backup of ${fmtNumber(candidates.length)} items downloaded`, 'good');
  };

  const start = async () => {
    try {
      const job = await createCleanupJob(account.id, title, filter, options);
      setConfirming(false);
      void startJob(job.id);
      navigate('jobs');
    } catch (err) {
      toast(`The cleanup could not be saved: ${errorMessage(err)}`, 'critical');
    }
  };

  return (
    <>
      <PageHeader
        title="Cleanup"
        description="Choose what to remove, preview exactly what matches, then let Xomoni work through it at a safe pace."
      />
      {needsArchive && (
        <div className="mb-4">
          <Callout
            tone="critical"
            icon={<TriangleAlert size={14} />}
            title="No archive imported: old posts can be missed"
          >
            <p>
              X search doesn’t show posts older than about a week that have no likes, and your profile shows only your
              newest ~3,200 posts. Without your X archive, this cleanup can miss many old posts, replies and likes, and
              report fewer than you have. Download your archive from X and import it first.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Button size="sm" variant="primary" onClick={() => navigate('inventory')}>
                Import your archive
              </Button>
              <Toggle
                checked={missAcknowledged}
                onChange={setMissAcknowledged}
                label="Continue without it: I understand old posts may be missed"
              />
            </div>
          </Callout>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="1 · What to clean up">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TARGETS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTarget(t.value)}
                  className={cx(
                    'rounded-xl border p-3.5 text-left transition-colors',
                    target === t.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
                  )}
                >
                  <span className={cx(target === t.value ? 'text-accent' : 'text-ink-2')}>{t.icon}</span>
                  <div className="mt-2 text-sm font-medium text-ink">{t.label}</div>
                  <div className="tabular text-xs text-ink-2">{fmtNumber(counts?.[t.value].present ?? 0)} known</div>
                </button>
              ))}
            </div>
          </Card>

          <Card title="2 · Older than">
            <Segmented value={age} onChange={setAge} options={AGES.map((a) => ({ value: a.value, label: a.label }))} />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {age === 'custom' ? (
                <Field label="Remove everything before">
                  <input
                    type="date"
                    className="field"
                    value={customDate}
                    max={today}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                </Field>
              ) : (
                <div className="flex items-center gap-2 text-sm text-ink-2">
                  <CalendarClock size={15} className="text-muted" /> Before{' '}
                  <span className="font-medium text-ink">{fmtDate(before)}</span>
                </div>
              )}
            </div>
            {dateProblem && (
              <p role="alert" className="mt-3 text-xs text-critical">
                {dateProblem}
              </p>
            )}
            <div className="mt-4 space-y-3">
              <Toggle
                checked={useAfter}
                onChange={setUseAfter}
                label="Only within a date range"
                description="Leave anything older than a start date untouched."
              />
              {useAfter && (
                <div className="max-w-xs pl-12">
                  <Field label="Start date (inclusive)">
                    <input
                      type="date"
                      className="field"
                      value={afterDate}
                      onChange={(e) => setAfterDate(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>
            {target === 'like' && (
              <div className="mt-4">
                <Callout tone="accent" icon={<Info size={14} />} title="How like dates work">
                  X doesn’t record when you liked something. Xomoni uses the like time when it can be derived from your
                  Likes page, otherwise the liked post’s own date — so a recent like on an old post may also match.
                </Callout>
              </div>
            )}
          </Card>

          <Card title="3 · Keep" subtitle="Anything matching these rules is never touched.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(target === 'post' || target === 'reply') && (
                <Field label="Keep if it has at least … likes" hint="Leave empty to ignore">
                  <input
                    className="field"
                    inputMode="numeric"
                    placeholder="e.g. 50"
                    value={minLikes}
                    onChange={(e) => setMinLikes(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              )}
              <Field label="Keep if the text contains" hint="Comma or line separated, case-insensitive">
                <textarea
                  className="field min-h-[38px]"
                  rows={2}
                  placeholder="launch, #mytag"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                />
              </Field>
              <Field label="Always keep these posts" hint="Paste post links or ids">
                <textarea
                  className="field min-h-[38px]"
                  rows={2}
                  placeholder="https://x.com/you/status/…"
                  value={ids}
                  onChange={(e) => setIds(e.target.value)}
                />
              </Field>
            </div>
            {target === 'reply' && (
              <div className="mt-4">
                <Toggle
                  checked={skipSelfReplies}
                  onChange={setSkipSelfReplies}
                  label="Keep replies in my own threads"
                  description="Thread continuations are replies to yourself; keep them so threads stay whole."
                />
              </div>
            )}
          </Card>

          <Card title="4 · How to find them">
            <div className="space-y-4">
              <Toggle
                checked={options.sweep}
                onChange={(sweep) => setOptions({ ...options, sweep })}
                label={
                  target === 'post' || target === 'reply'
                    ? 'Sweep X search'
                    : target === 'like'
                      ? 'Sweep your Likes page'
                      : 'Sweep your profile'
                }
                description={
                  target === 'post' || target === 'reply'
                    ? 'Searches X for your matching posts (reaches far beyond the ~3,200 your profile shows) and removes them in place. If you have fewer than ~3,200 posts, your profile is swept first, since search leaves out old posts without likes.'
                    : 'Scrolls the page and removes matching items in place — the fewest page loads per item.'
                }
              />
              <Toggle
                checked={options.deep}
                onChange={(deep) => setOptions({ ...options, deep })}
                label="Deep clean from inventory"
                description="Visits each remaining matching item one by one — needed for items only found in your archive."
              />
              {target === 'like' && (
                <>
                  <Toggle
                    checked={options.ghostLikes}
                    onChange={(ghostLikes) => setOptions({ ...options, ghostLikes })}
                    label="Remove “ghost” likes"
                    description="Old likes X no longer displays can only be removed by liking again, then unliking."
                  />
                  {options.ghostLikes && (
                    <Callout tone="warn" icon={<TriangleAlert size={14} />} title="Authors may be notified">
                      Re-liking can send a like notification to the author before it’s removed, and it uses your daily
                      like budget. Xomoni paces this much more slowly.
                    </Callout>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card title="Review">
            <div className="text-xs font-medium text-ink-2">Matching in your inventory</div>
            <div className="tabular mt-1 text-4xl font-semibold tracking-tight">
              {candidates ? fmtNumber(candidates.length) : '…'}
            </div>
            <p className="mt-1 text-xs text-ink-2">
              {TARGET_PLURAL[target]} before {fmtDate(before)}
              {options.sweep && ' · the sweep may find more that aren’t in your inventory yet'}
            </p>

            {!!candidates?.length && (
              <ul className="mt-4 space-y-2 border-t border-line pt-3">
                {candidates.slice(0, 4).map((c) => (
                  <li key={c.key} className="text-xs">
                    <span className="tabular text-muted">{fmtDate(c.createdAt)}</span>
                    <p className="line-clamp-2 text-ink">{c.text || <span className="text-muted">(no text)</span>}</p>
                  </li>
                ))}
                {candidates.length > 4 && (
                  <li className="text-xs text-muted">and {fmtNumber(candidates.length - 4)} more</li>
                )}
              </ul>
            )}

            {rule && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
                <div className="flex items-center justify-between">
                  <span>Estimated time</span>
                  <span className="font-medium text-ink">≈ {fmtDuration(eta)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span>Pacing</span>
                  <span className="text-ink">
                    {rule.minDelay}–{rule.maxDelay}s · max {fmtNumber(rule.dailyCap)}/day
                  </span>
                </div>
                {days > 1 && (
                  <p className="mt-2 text-muted">
                    Spread over about {days} days by the daily cap. Xomoni waits and continues automatically.
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <Button className="w-full" icon={<Download size={14} />} onClick={backup} disabled={!candidates?.length}>
                Download backup (JSON)
              </Button>
              <Button
                className="w-full"
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => setConfirming(true)}
                disabled={!canStart}
              >
                Start cleanup
              </Button>
              {run.status !== 'idle' && (
                <p className="text-center text-xs text-muted">Another job is running. Pause it first.</p>
              )}
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[11px] text-muted">
              <ShieldCheck size={12} className="mt-px shrink-0" /> Stops automatically if X rate-limits, flags, or locks
              the account.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmStart
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void start()}
        title={title}
        count={candidates?.length ?? 0}
        sweep={options.sweep}
      />
    </>
  );
}

function ConfirmStart({
  open,
  onClose,
  onConfirm,
  title,
  count,
  sweep,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  count: number;
  sweep: boolean;
}) {
  const [typed, setTyped] = useState('');
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Start this cleanup?"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={typed.trim().toUpperCase() !== 'DELETE'}
            onClick={() => {
              setTyped('');
              onConfirm();
            }}
          >
            Start cleanup
          </Button>
        </>
      }
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-2">
        {fmtNumber(count)} known items match{sweep ? ', plus any the sweep finds on X' : ''}. Removed posts and likes
        cannot be restored by Xomoni or X.
      </p>
      <p className="mt-2">Keep this tab and the X worker window open. You can pause at any time and resume later.</p>
      <div className="mt-4">
        <Field
          label={
            <>
              Type <span className="font-mono font-semibold text-ink">DELETE</span> to confirm
            </>
          }
        >
          <input className="field" value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
