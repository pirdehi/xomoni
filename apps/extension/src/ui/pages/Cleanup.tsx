import {
  Body1,
  Body1Strong,
  Caption1,
  Input,
  Text,
  Textarea,
  createFocusOutlineStyle,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  ArrowRepeatAll20Filled,
  ArrowRepeatAll20Regular,
  ArrowReply20Filled,
  ArrowReply20Regular,
  CalendarClock16Regular,
  CheckmarkCircle20Filled,
  Circle20Regular,
  Clock16Regular,
  Compose20Filled,
  Compose20Regular,
  Delete16Regular,
  Delete20Regular,
  ErrorCircle16Regular,
  Gauge16Regular,
  Heart20Filled,
  Heart20Regular,
  Info16Regular,
  ShieldCheckmark16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useMemo, useState } from 'react';
import { createCleanupJob } from '../../engine/runner';
import { archiveImported, getSettings } from '../../shared/db';
import { actionFor, estimateDuration, findCandidates, normalizeKeywords, parseIdList } from '../../shared/filter';
import { DAY } from '../../shared/time';
import type { CleanupFilter, CleanupOptions, CleanupTarget } from '../../shared/types';
import type { PageProps } from '../navigation';
import { Button, Callout, Card, Disclosure, Field, Modal, PageHeader, Segmented, Toggle } from '../components/ui';
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

/** The four things a cleanup can remove, each with its outline icon and the filled one it shows while chosen. */
const TARGETS: { value: CleanupTarget; label: string; icon: ReactNode; chosenIcon: ReactNode }[] = [
  { value: 'post', label: 'Posts', icon: <Compose20Regular />, chosenIcon: <Compose20Filled /> },
  { value: 'reply', label: 'Replies', icon: <ArrowReply20Regular />, chosenIcon: <ArrowReply20Filled /> },
  { value: 'repost', label: 'Reposts', icon: <ArrowRepeatAll20Regular />, chosenIcon: <ArrowRepeatAll20Filled /> },
  { value: 'like', label: 'Likes', icon: <Heart20Regular />, chosenIcon: <Heart20Filled /> },
];

/** The verb a job title uses for each target. */
const VERB: Record<CleanupTarget, string> = { post: 'Delete', reply: 'Delete', repost: 'Undo', like: 'Remove' };

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();

/** Two columns from this width up (Tailwind's former `sm`). */
const SM = '@media (min-width: 640px)';
/** The form and the review side by side from this width up (Tailwind's former `lg`). */
const LG = '@media (min-width: 1024px)';

const useStyles = makeStyles({
  notice: { marginBottom: tokens.spacingVerticalL },
  noticeText: { margin: 0 },
  noticeActions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalM,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    [LG]: { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start' },
  },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL, minWidth: 0 },
  aside: { minWidth: 0, [LG]: { position: 'sticky', top: tokens.spacingVerticalXXL } },
  targets: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalM,
    [SM]: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
  },
  target: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    rowGap: tokens.spacingVerticalXXS,
    margin: 0,
    padding: tokens.spacingHorizontalM,
    textAlign: 'start',
    fontFamily: 'inherit',
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    cursor: 'pointer',
    transitionProperty: 'background-color, border-color, box-shadow',
    transitionDuration: tokens.durationFaster,
    transitionTimingFunction: tokens.curveEasyEase,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1Hover}`,
    },
    ':active': { backgroundColor: tokens.colorNeutralBackground1Pressed },
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
    ...createFocusOutlineStyle(),
  },
  targetChosen: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
    boxShadow: `inset 0 0 0 ${tokens.strokeWidthThin} ${tokens.colorBrandStroke1}`,
    ':hover': {
      backgroundColor: tokens.colorBrandBackground2Hover,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
    },
    ':active': { backgroundColor: tokens.colorBrandBackground2Pressed },
  },
  targetHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: tokens.spacingVerticalS,
  },
  targetIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
  },
  targetIconChosen: { backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand },
  targetMark: { display: 'inline-flex', color: tokens.colorNeutralForeground4 },
  targetMarkChosen: { color: tokens.colorBrandForeground1 },
  targetCount: { color: tokens.colorNeutralForeground2, fontVariantNumeric: 'tabular-nums' },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    [SM]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  spaced: { marginTop: tokens.spacingVerticalL },
  control: { width: '100%' },
  before: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'start',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
  },
  beforeIcon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  strong: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  problem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorStatusDangerForeground1,
  },
  problemIcon: { flexShrink: 0 },
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  roomy: { rowGap: tokens.spacingVerticalL },
  rangeField: { maxWidth: '20rem', paddingLeft: '48px' },
  reviewLabel: { display: 'block', fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  reviewCount: {
    marginTop: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeHero800,
    lineHeight: tokens.lineHeightHero800,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums',
  },
  reviewScope: { margin: `${tokens.spacingVerticalXS} 0 0`, color: tokens.colorNeutralForeground2 },
  preview: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    listStyleType: 'none',
    margin: `${tokens.spacingVerticalL} 0 0`,
    padding: `${tokens.spacingVerticalM} 0 0`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  previewDate: { display: 'block', color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  // At most two lines of each post (Caption1's line height), cut off below.
  previewText: {
    display: 'block',
    maxHeight: `calc(2 * ${tokens.lineHeightBase200})`,
    overflow: 'hidden',
    margin: 0,
    color: tokens.colorNeutralForeground1,
    overflowWrap: 'anywhere',
  },
  muted: { color: tokens.colorNeutralForeground3 },
  estimate: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  estimateRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
  },
  estimateLabel: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  estimateValue: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'end',
  },
  estimateNote: { margin: `${tokens.spacingVerticalXS} 0 0`, color: tokens.colorNeutralForeground3 },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalL,
  },
  fullWidth: { width: '100%' },
  busy: { margin: 0, textAlign: 'center', color: tokens.colorNeutralForeground3 },
  safety: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalL} 0 0`,
    color: tokens.colorNeutralForeground3,
  },
  safetyIcon: { flexShrink: 0, color: tokens.colorStatusSuccessForeground1 },
  paragraph: { margin: 0 },
  summary: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorStatusDangerBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusDangerBorder1}`,
  },
  summaryIcon: { flexShrink: 0, marginTop: '1px', color: tokens.colorStatusDangerForeground1 },
  summaryTitle: { margin: 0, color: tokens.colorNeutralForeground1 },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
});

/** Joins phrases as people write them: "a", "a and b", "a, b and c". */
const listed = (parts: readonly string[]) =>
  parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;

/**
 * What a cleanup keeps, in one line, for the folded *Exceptions* (#199): what the filter's keep rules come to, or
 * that nothing is kept. Mirrors the filter, so it says exactly what the job will spare.
 */
export function exceptionsSummary(filter: CleanupFilter): string {
  const kept = [
    filter.keepMinLikes && (filter.target === 'post' || filter.target === 'reply')
      ? `posts with ${fmtNumber(filter.keepMinLikes)}+ likes`
      : null,
    filter.keepKeywords.length ? `text with ${filter.keepKeywords.map((k) => `“${k}”`).join(', ')}` : null,
    filter.keepIds.length
      ? `${fmtNumber(filter.keepIds.length)} chosen ${filter.keepIds.length === 1 ? 'post' : 'posts'}`
      : null,
    filter.target === 'reply' && filter.skipSelfReplies ? 'replies in your own threads' : null,
  ].filter((part): part is string => !!part);
  return kept.length ? `Keeps ${listed(kept)}.` : 'Nothing is kept: everything that matches is removed.';
}

/**
 * How a cleanup finds what it removes, in one line, for the folded *Advanced* (#199). Says when neither way is on,
 * since Start stays off then.
 */
export function findingSummary(target: CleanupTarget, options: CleanupOptions): string {
  const sweep =
    target === 'post' || target === 'reply'
      ? 'searches X'
      : target === 'like'
        ? 'goes through your Likes page'
        : 'goes through your profile';
  const ways = [options.sweep ? sweep : null, options.deep ? 'visits each known one' : null].filter(
    (way): way is string => !!way,
  );
  if (!ways.length) return 'Neither way is on: turn one on to start.';
  const ghost = target === 'like' && options.ghostLikes ? ' Ghost likes are removed too.' : '';
  return `Xomoni ${listed(ways)}.${ghost}`;
}

/**
 * Builds a cleanup filter (what, older than when, what to keep, how to find it), previews the
 * matching inventory items with a time estimate from the current pacing, and offers a JSON backup. The exceptions
 * and how Xomoni finds the items are folded, each with a one-line summary, so a cleanup takes three choices (#199).
 * Without an imported archive it warns that old posts can be missed (PLAYBOOK E2) and starts only once the
 * person acknowledges it. The job is created and started only after the user types DELETE in the
 * confirmation dialog. Drawn with Fluent UI (ADR-0019): the targets are selectable cards (`aria-pressed`).
 */
export function CleanupPage({ account, navigate }: PageProps) {
  const styles = useStyles();
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

  const keepSummary = exceptionsSummary(filter);
  const findSummary = findingSummary(target, options);

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
        <div className={styles.notice}>
          <Callout tone="critical" icon={<Warning16Regular />} title="No archive imported: old posts can be missed">
            <p className={styles.noticeText}>
              X search doesn’t show posts older than about a week that have no likes, and your profile shows only your
              newest ~3,200 posts. Without your X archive, this cleanup can miss many old posts, replies and likes, and
              report fewer than you have. Get your archive first: in the Library, Xomoni asks X for it and imports it.
            </p>
            <div className={styles.noticeActions}>
              <Button size="sm" variant="primary" onClick={() => navigate('library')}>
                Get my archive
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
      <div className={styles.layout}>
        <div className={styles.form}>
          <Card title="1 · What to clean up">
            <div className={styles.targets}>
              {TARGETS.map((t) => {
                const chosen = target === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => setTarget(t.value)}
                    className={mergeClasses(styles.target, chosen && styles.targetChosen)}
                  >
                    <span className={styles.targetHead}>
                      <span className={mergeClasses(styles.targetIcon, chosen && styles.targetIconChosen)}>
                        {chosen ? t.chosenIcon : t.icon}
                      </span>
                      <span className={mergeClasses(styles.targetMark, chosen && styles.targetMarkChosen)}>
                        {chosen ? <CheckmarkCircle20Filled /> : <Circle20Regular />}
                      </span>
                    </span>
                    <Body1Strong>{t.label}</Body1Strong>
                    <Caption1 className={styles.targetCount}>
                      {fmtNumber(counts?.[t.value].present ?? 0)} in your copy
                    </Caption1>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="2 · Older than">
            <Segmented value={age} onChange={setAge} options={AGES.map((a) => ({ value: a.value, label: a.label }))} />
            <div className={mergeClasses(styles.fieldGrid, styles.spaced)}>
              {age === 'custom' ? (
                <Field label="Remove everything before">
                  <Input
                    type="date"
                    className={styles.control}
                    value={customDate}
                    max={today}
                    onChange={(_, data) => setCustomDate(data.value)}
                  />
                </Field>
              ) : (
                <Body1 className={styles.before}>
                  <CalendarClock16Regular className={styles.beforeIcon} /> Before{' '}
                  <span className={styles.strong}>{fmtDate(before)}</span>
                </Body1>
              )}
            </div>
            {dateProblem && (
              <Caption1 as="p" role="alert" className={styles.problem}>
                <ErrorCircle16Regular className={styles.problemIcon} />
                {dateProblem}
              </Caption1>
            )}
            <div className={mergeClasses(styles.stack, styles.spaced)}>
              <Toggle
                checked={useAfter}
                onChange={setUseAfter}
                label="Only within a date range"
                description="Leave anything older than a start date untouched."
              />
              {useAfter && (
                <div className={styles.rangeField}>
                  <Field label="Start date (inclusive)">
                    <Input
                      type="date"
                      className={styles.control}
                      value={afterDate}
                      onChange={(_, data) => setAfterDate(data.value)}
                    />
                  </Field>
                </div>
              )}
            </div>
            {target === 'like' && (
              <div className={styles.spaced}>
                <Callout tone="accent" icon={<Info16Regular />} title="How like dates work">
                  X doesn’t record when you liked something. Xomoni uses the like time when it can be derived from your
                  Likes page, otherwise the liked post’s own date — so a recent like on an old post may also match.
                </Callout>
              </div>
            )}
          </Card>

          <Card title="3 · Exceptions" subtitle="Optional: what to keep even when it matches.">
            <Disclosure label="Choose what to keep" summary={keepSummary}>
              <div className={styles.fieldGrid}>
                {(target === 'post' || target === 'reply') && (
                  <Field label="Keep if it has at least … likes" hint="Leave empty to ignore">
                    <Input
                      className={styles.control}
                      inputMode="numeric"
                      placeholder="e.g. 50"
                      value={minLikes}
                      onChange={(_, data) => setMinLikes(data.value.replace(/\D/g, ''))}
                    />
                  </Field>
                )}
                <Field label="Keep if the text contains" hint="Comma or line separated, case-insensitive">
                  <Textarea
                    className={styles.control}
                    resize="vertical"
                    rows={2}
                    placeholder="launch, #mytag"
                    value={keywords}
                    onChange={(_, data) => setKeywords(data.value)}
                  />
                </Field>
                <Field label="Always keep these posts" hint="Paste post links or ids">
                  <Textarea
                    className={styles.control}
                    resize="vertical"
                    rows={2}
                    placeholder="https://x.com/you/status/…"
                    value={ids}
                    onChange={(_, data) => setIds(data.value)}
                  />
                </Field>
              </div>
              {target === 'reply' && (
                <div className={styles.spaced}>
                  <Toggle
                    checked={skipSelfReplies}
                    onChange={setSkipSelfReplies}
                    label="Keep replies in my own threads"
                    description="Thread continuations are replies to yourself; keep them so threads stay whole."
                  />
                </div>
              )}
            </Disclosure>
          </Card>

          <Disclosure label="Advanced: how Xomoni finds them" summary={findSummary}>
            <Card>
              <div className={mergeClasses(styles.stack, styles.roomy)}>
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
                  label="Visit each known post"
                  description="Opens each remaining post Xomoni knows of, one by one: needed for posts only in your archive."
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
                      <Callout tone="warn" icon={<Warning16Regular />} title="Authors may be notified">
                        Re-liking can send a like notification to the author before it’s removed, and it uses your daily
                        like budget. Xomoni paces this much more slowly.
                      </Callout>
                    )}
                  </>
                )}
              </div>
            </Card>
          </Disclosure>
        </div>

        <div className={styles.aside}>
          <Card title="Review">
            <Caption1 className={styles.reviewLabel}>Matching in your copy</Caption1>
            <div className={styles.reviewCount}>{candidates ? fmtNumber(candidates.length) : '…'}</div>
            <Caption1 as="p" className={styles.reviewScope}>
              {TARGET_PLURAL[target]} before {fmtDate(before)}
              {options.sweep && ' · searching X may find more that aren’t in your copy yet'}
            </Caption1>

            {!!candidates?.length && (
              <ul className={styles.preview}>
                {candidates.slice(0, 4).map((c) => (
                  <li key={c.key}>
                    <Caption1 className={styles.previewDate}>{fmtDate(c.createdAt)}</Caption1>
                    <Caption1 as="p" className={styles.previewText}>
                      {c.text || <span className={styles.muted}>(no text)</span>}
                    </Caption1>
                  </li>
                ))}
                {candidates.length > 4 && (
                  <li>
                    <Caption1 className={styles.muted}>and {fmtNumber(candidates.length - 4)} more</Caption1>
                  </li>
                )}
              </ul>
            )}

            {rule && (
              <div className={styles.estimate}>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>
                    <Clock16Regular />
                    Estimated time
                  </span>
                  <span className={styles.estimateValue}>≈ {fmtDuration(eta)}</span>
                </div>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>
                    <Gauge16Regular />
                    Pacing
                  </span>
                  <span className={styles.estimateValue}>
                    {rule.minDelay}–{rule.maxDelay}s · max {fmtNumber(rule.dailyCap)}/day
                  </span>
                </div>
                {days > 1 && (
                  <p className={styles.estimateNote}>
                    Spread over about {days} days by the daily cap. Xomoni waits and continues automatically.
                  </p>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <Button
                className={styles.fullWidth}
                icon={<ArrowDownload16Regular />}
                onClick={backup}
                disabled={!candidates?.length}
              >
                Download backup (JSON)
              </Button>
              <Button
                className={styles.fullWidth}
                variant="danger"
                icon={<Delete16Regular />}
                onClick={() => setConfirming(true)}
                disabled={!canStart}
              >
                Start cleanup
              </Button>
              {run.status !== 'idle' && (
                <Caption1 as="p" className={styles.busy}>
                  Another job is running. Pause it first.
                </Caption1>
              )}
            </div>
            <Caption1 as="p" className={styles.safety}>
              <ShieldCheckmark16Regular className={styles.safetyIcon} />
              <span>Stops automatically if X rate-limits, flags, or locks the account.</span>
            </Caption1>
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

/**
 * The last step before a cleanup starts: names the job, says how many posts in your copy match and that removals can't be
 * undone, and enables Start only once DELETE is typed (any case, spaces around it ignored). The typed word is
 * forgotten whenever the dialog closes, so it never stays armed for the next opening.
 */
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
  const styles = useStyles();
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
      <div className={styles.summary} data-tone="critical">
        <Delete20Regular className={styles.summaryIcon} />
        <Body1Strong as="p" className={styles.summaryTitle}>
          {title}
        </Body1Strong>
      </div>
      <Text as="p" className={styles.paragraph}>
        {fmtNumber(count)} in your copy match{sweep ? ', plus any that searching X finds' : ''}. Removed posts and likes
        cannot be restored by Xomoni or X.
      </Text>
      <Text as="p" className={styles.paragraph}>
        Keep this tab open (minimizing it is fine), and part of the X window on screen: not minimized or fully covered.
        Or press Run hidden once it starts and share the X tab: then the X window may be minimized too. You can pause at
        any time and resume later.
      </Text>
      <Field
        label={
          <>
            Type <span className={styles.code}>DELETE</span> to confirm
          </>
        }
      >
        <Input
          className={styles.control}
          value={typed}
          data-autofocus
          autoComplete="off"
          spellCheck={false}
          onChange={(_, data) => setTyped(data.value)}
        />
      </Field>
    </Modal>
  );
}
