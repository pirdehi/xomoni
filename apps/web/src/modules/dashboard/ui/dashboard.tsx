'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, Laptop, LogOut, Puzzle, RefreshCw, ShieldAlert } from 'lucide-react';
import { INSTALL_URL } from '@/shared/config/site';
import { isOnline, jobProgress, jobStateView, relativeTime, type Tone } from '../domain/job-status';
import type { DashboardSnapshot, Device, JobSummary } from '../domain/model';
import { RISK_LEVEL, accountRisks, jobsNeedingYou, type AccountRisk } from '../domain/risk';
import type { PairingResult } from '../domain/pairing';
import { PairingPanel } from './pairing-panel';
import { useLiveDashboard } from './use-live-dashboard';

/** Who is signed in, as the dashboard header shows them. */
export interface DashboardViewer {
  /** User id; scopes the live feed. */
  id: string;
  /** Account email. */
  email: string;
  /** Display name. */
  name: string;
  /** Profile picture, if any. */
  avatarUrl: string | null;
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent',
  serious: 'bg-serious/15 text-ink',
  warn: 'bg-warn/20 text-warn-ink',
  critical: 'bg-critical/12 text-critical',
  good: 'bg-good/12 text-good-ink',
};

const BAR_CLASS: Record<Tone, string> = {
  neutral: 'bg-muted',
  accent: 'bg-accent',
  serious: 'bg-serious',
  warn: 'bg-warn',
  critical: 'bg-critical',
  good: 'bg-good',
};

/**
 * The signed-in dashboard: account bar, jobs that need the person, each X account's risk level, live jobs and
 * connected browsers. It shows; it never starts, resumes or changes a job (ADR-0006).
 */
export function Dashboard({ viewer, initial }: { viewer: DashboardViewer; initial: DashboardSnapshot }) {
  const { devices, jobs, live, disconnect, createPairingCode } = useLiveDashboard(viewer.id, initial);
  const now = useNow(30_000);

  async function onDisconnect(device: Device) {
    if (!confirm(`Disconnect “${device.name}”? Its job history on this page is removed too. Nothing on X changes.`))
      return;
    const error = await disconnect(device);
    if (error) alert(error);
  }

  const deviceName = new Map(devices.map((d) => [d.id, d.name]));
  const needsYou = jobsNeedingYou(jobs);
  const risks = accountRisks(jobs);

  return (
    <div className="space-y-10">
      <AccountBar viewer={viewer} live={live} />

      {needsYou.length > 0 && <NeedsYou jobs={needsYou} deviceName={deviceName} />}
      {risks.length > 0 && <AccountRisks risks={risks} deviceName={deviceName} now={now} />}

      {devices.length === 0 ? (
        <ConnectBrowser createCode={createPairingCode} />
      ) : (
        <section aria-labelledby="jobs-title">
          <h2 id="jobs-title" className="text-lg font-semibold">
            Jobs
          </h2>
          {jobs.length === 0 ? (
            <p className="card mt-4 p-6 text-ink-2">
              No jobs yet. Start a cleanup or a scan in the extension and it shows up here as it runs.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} device={deviceName.get(job.deviceId)} now={now} />
              ))}
            </ul>
          )}
        </section>
      )}

      {devices.length > 0 && (
        <section aria-labelledby="devices-title">
          <h2 id="devices-title" className="text-lg font-semibold">
            Connected browsers
          </h2>
          <ul className="card mt-4 divide-y divide-line">
            {devices.map((device) => {
              const online = isOnline(device, now);
              return (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <Laptop className="size-5 text-muted" aria-hidden />
                    <div>
                      <p className="font-medium">{device.name}</p>
                      <p className="text-sm text-muted">
                        <span className={online ? 'text-good-ink' : undefined}>
                          {online ? 'Online' : `Last seen ${relativeTime(device.lastSeenAt, now)}`}
                        </span>{' '}
                        · Extension v{device.extensionVersion}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDisconnect(device)}
                    className="btn btn-secondary py-1.5 text-sm"
                  >
                    Disconnect
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <PairingPanel createCode={createPairingCode} />
          </div>
        </section>
      )}
    </div>
  );
}

function AccountBar({ viewer, live }: { viewer: DashboardViewer; live: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {viewer.avatarUrl ? (
          // Google profile pictures, loaded as they are (no optimizer) with the referrer off.
          <Image
            src={viewer.avatarUrl}
            alt=""
            width={44}
            height={44}
            unoptimized
            referrerPolicy="no-referrer"
            className="size-11 rounded-full"
          />
        ) : (
          <div className="flex size-11 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">
            {(viewer.name || viewer.email).slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{viewer.name}</h1>
          <p className="text-sm text-muted">{viewer.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted" title="Updates appear as they happen">
          <span className={`size-2 rounded-full ${live ? 'bg-good' : 'bg-muted'}`} aria-hidden />
          {live ? 'Live' : 'Connecting…'}
        </span>
        <Link href="/account" className="btn btn-secondary py-2">
          Account
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn btn-secondary py-2">
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

function ConnectBrowser({ createCode }: { createCode: () => Promise<PairingResult> }) {
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="connect-title">
      <div className="flex items-center gap-2 text-accent">
        <Puzzle className="size-5" aria-hidden />
        <p className="text-sm font-medium">One more step</p>
      </div>
      <h2 id="connect-title" className="mt-2 text-2xl font-semibold tracking-tight">
        Connect your browser
      </h2>
      <p className="mt-2 max-w-2xl leading-relaxed text-ink-2">
        Cleanups run in the Xomoni extension on your computer. Connect it to this account and its jobs appear here live.
        The extension only reports status: what it is doing, never what you posted.
      </p>
      <ol className="mt-6 space-y-4">
        <Step n={1}>
          <a href={INSTALL_URL} className="text-accent underline underline-offset-2">
            Install the Xomoni extension
          </a>{' '}
          in Chrome, Edge or Brave on your computer.
        </Step>
        <Step n={2}>
          <span className="mb-3 block">
            Get a one-time code, then type it in the extension under{' '}
            <strong className="font-medium text-ink">Settings → xomoni.com</strong>.
          </span>
          <PairingPanel createCode={createCode} />
        </Step>
        <Step n={3}>This page updates by itself as soon as your browser connects.</Step>
      </ol>
      <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted">
        <RefreshCw className="size-4 animate-spin [animation-duration:3s]" aria-hidden />
        Waiting for your browser…
      </p>
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-medium tabular">
        {n}
      </span>
      <span className="leading-relaxed text-ink-2">{children}</span>
    </li>
  );
}

/** Jobs waiting for something only the person can do; first on the page. */
function NeedsYou({ jobs, deviceName }: { jobs: JobSummary[]; deviceName: Map<string, string> }) {
  return (
    <section aria-labelledby="needs-you-title" className="card border-serious/50 p-5 sm:p-6">
      <h2 id="needs-you-title" className="flex items-center gap-2 text-lg font-semibold">
        <CircleAlert className="size-5 text-serious" aria-hidden />
        Needs you
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">
        Finish these steps in the Xomoni window on that computer; the job goes on by itself afterwards. This page can’t
        continue a job for you.
      </p>
      <ul className="mt-4 divide-y divide-line">
        {jobs.map((job) => {
          const device = deviceName.get(job.deviceId);
          return (
            <li key={job.id} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{job.title}</p>
              <p className="text-sm text-muted">
                @{job.xHandle}
                {device && ` · ${device}`}
              </p>
              {job.stateReason && <p className="mt-1 text-sm text-ink">{job.stateReason}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Each X account's risk level on each browser, worst first, with what the level means. */
function AccountRisks({
  risks,
  deviceName,
  now,
}: {
  risks: AccountRisk[];
  deviceName: Map<string, string>;
  now: number;
}) {
  return (
    <section aria-labelledby="accounts-title">
      <h2 id="accounts-title" className="text-lg font-semibold">
        X accounts
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        How hard X has pushed back lately, as each browser’s extension reported it. Xomoni slows down on its own as the
        level rises.
      </p>
      <ul className="card mt-4 divide-y divide-line">
        {risks.map((risk) => {
          const level = RISK_LEVEL[risk.level];
          const device = deviceName.get(risk.deviceId);
          return (
            <li
              key={`${risk.deviceId}-${risk.xHandle}`}
              className="flex flex-wrap items-start justify-between gap-3 p-4"
            >
              <div className="flex min-w-0 gap-3">
                <ShieldAlert
                  className={`mt-0.5 size-5 shrink-0 ${risk.level >= 3 ? 'text-critical' : 'text-muted'}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="font-medium">
                    @{risk.xHandle}
                    <span className="text-sm font-normal text-muted">
                      {device && ` · ${device}`} · reported {relativeTime(risk.reportedAt, now)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-2">{level.meaning}</p>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[level.tone]}`}>
                Risk level {risk.level}: {level.label}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function JobRow({ job, device, now }: { job: JobSummary; device: string | undefined; now: number }) {
  const state = jobStateView(job.state);
  const pct = jobProgress(job);

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{job.title}</p>
          <p className="mt-0.5 text-sm text-muted">
            @{job.xHandle}
            {device && ` · ${device}`} · updated {relativeTime(job.updatedAt, now)}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[state.tone]}`}>{state.label}</span>
      </div>

      {pct !== null && (
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress"
        >
          <div className={`h-full rounded-full ${BAR_CLASS[state.tone]}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {job.kind === 'scan' ? (
          <Count label="Scanned" value={job.scanned} />
        ) : (
          <>
            <Count label={job.title.toLowerCase().includes('like') ? 'Removed' : 'Deleted'} value={job.done} />
            <Count label="Matched" value={job.matched} />
            <Count label="Skipped" value={job.skipped} />
            {job.failed > 0 && <Count label="Failed" value={job.failed} />}
          </>
        )}
        {pct !== null && <Count label="Progress" value={`${pct}%`} />}
      </dl>

      {(job.stateReason || job.phase) && (
        <p
          className={`mt-3 flex gap-2 text-sm ${job.state === 'waiting' ? 'text-ink' : 'text-ink-2'}`}
          role={job.state === 'waiting' ? 'alert' : undefined}
        >
          {job.state === 'waiting' && <CircleAlert className="mt-0.5 size-4 shrink-0 text-serious" aria-hidden />}
          {job.stateReason || job.phase}
        </p>
      )}
    </li>
  );
}

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular">{typeof value === 'number' ? value.toLocaleString('en-US') : value}</dd>
    </div>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
