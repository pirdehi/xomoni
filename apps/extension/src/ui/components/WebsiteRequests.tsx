import { Body1, Body1Strong, Caption1, makeStyles, tokens } from '@fluentui/react-components';
import { Globe16Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../../shared/db';
import {
  CANCELLED_FROM_WEBSITE,
  PAUSED_FROM_WEBSITE,
  clearAsk,
  clearStop,
  pendingAsk,
  pendingStop,
} from '../../shared/website-requests';
import { fmtDuration } from '../format';
import { startJob, useRisk, useRunner } from '../hooks';
import { runner } from '../../engine/platform';
import { Button, Modal, useNow } from './ui';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  job: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  jobText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  icon: { flexShrink: 0, marginTop: '2px', color: tokens.colorNeutralForeground3 },
  muted: { color: tokens.colorNeutralForeground3 },
});

/**
 * What xomoni.com asked of a job in this browser (ADR-0027, #251). A stop is carried out by the tab whose runner has
 * the job, at once. A resume shows Xomoni's own confirmation: only *Resume* here starts the job, through the same
 * consent and safety checks as its card; *Not now* leaves it as it is. The app shell renders it in every tab.
 */
export function WebsiteRequests() {
  const run = useRunner();
  const stop = useLiveQuery(async () => pendingStop());
  useEffect(() => {
    if (!stop || run.jobId !== stop.jobId || run.status === 'idle' || run.status === 'stopping') return;
    void clearStop(stop.jobId);
    if (stop.state === 'paused') runner.pause(PAUSED_FROM_WEBSITE);
    else runner.cancel(CANCELLED_FROM_WEBSITE);
  }, [stop, run.jobId, run.status]);
  const ask = useLiveQuery(async () => pendingAsk());
  return ask ? <ResumeAsked key={ask.jobId} jobId={ask.jobId} /> : null;
}

function ResumeAsked({ jobId }: { jobId: string }) {
  const s = useStyles();
  const run = useRunner();
  const job = useLiveQuery(async () => db.jobs.get(jobId), [jobId]);
  const account = useLiveQuery(async () => (job ? db.accounts.get(job.accountId) : undefined), [job?.accountId]);
  const risk = useRisk(job?.accountId);
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  if (job === undefined) return null;
  const close = () => void clearAsk(jobId);
  const heldUntil = risk?.resumeAt && risk.resumeAt > now ? risk.resumeAt : null;
  const held = !!risk && (risk.fullStop || heldUntil != null);
  const ended = job.state === 'completed' || job.state === 'cancelled';
  const busyElsewhere = run.status !== 'idle';
  const canResume = !ended && !held && !busyElsewhere;
  const resume = async () => {
    setBusy(true);
    await clearAsk(jobId);
    await startJob(jobId);
  };
  return (
    <Modal
      open
      onClose={() => !busy && close()}
      title="xomoni.com asks to resume a job"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Not now
          </Button>
          {canResume && (
            <Button variant="primary" disabled={busy} onClick={() => void resume()} data-autofocus>
              Resume
            </Button>
          )}
        </>
      }
    >
      <div className={s.body}>
        <div className={s.job}>
          <Globe16Regular className={s.icon} aria-hidden />
          <div className={s.jobText}>
            <Body1Strong>{job.title}</Body1Strong>
            {account?.handle && <Caption1 className={s.muted}>@{account.handle}</Caption1>}
          </div>
        </div>
        <Body1>
          {ended
            ? 'This job has already ended, so there is nothing to resume.'
            : held
              ? heldUntil
                ? `Xomoni is holding this account back for its safety. It can resume in ${fmtDuration(heldUntil - now)}, from the job’s card.`
                : 'Xomoni stopped this account’s jobs for its safety. Look at the job’s card before going on.'
              : busyElsewhere
                ? 'Another job is running. Resume this one when it ends.'
                : 'The website can only ask. Nothing runs on X until you choose Resume here.'}
        </Body1>
      </div>
    </Modal>
  );
}
