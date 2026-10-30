'use client';

import { useEffect, useState, useTransition } from 'react';
import { CircleAlert, Laptop, LogOut, Puzzle, RefreshCw, Trash } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/types';
import { INSTALL_URL } from '@/lib/site';
import { deleteAccount } from './actions';

type Device = Tables<'devices'>;
type Job = Tables<'jobs'>;

export interface Viewer {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

type Tone = 'neutral' | 'accent' | 'serious' | 'warn' | 'critical' | 'good';

// Same labels as the extension (src/ui/format.ts).
const JOB_STATE: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  waiting: { label: 'Needs you', tone: 'serious' },
  paused: { label: 'Paused', tone: 'warn' },
  blocked: { label: 'Stopped for safety', tone: 'critical' },
  completed: { label: 'Completed', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'critical' },
};

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

/** A device counts as online if it reported in the last few minutes. */
const ONLINE_MS = 3 * 60_000;

export function Dashboard({ viewer, initialDevices, initialJobs }: {
  viewer: Viewer;
  initialDevices: Device[];
  initialJobs: Job[];
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [jobs, setJobs] = useState(initialJobs);
  const [live, setLive] = useState(false);
  const now = useNow(30_000);

  useEffect(() => {
    const supabase = createClient();
    const filter = `user_id=eq.${viewer.id}`;

    // Catch up on anything that changed while the feed was down (first connect, sleep, network loss).
    async function refetch() {
      const [d, j] = await Promise.all([
        supabase.from('devices').select('*').order('last_seen_at', { ascending: false }),
        supabase.from('jobs').select('*').order('updated_at', { ascending: false }).limit(50),
      ]);
      if (d.data) setDevices(d.data);
      if (j.data) setJobs(j.data);
    }
    const onVisible = () => document.visibilityState === 'visible' && refetch();
    document.addEventListener('visibilitychange', onVisible);

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    (async () => {
      // Load the user's JWT first; otherwise the join goes out with the anon key and RLS rejects it.
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase
        .channel('dashboard')
        // "SUBSCRIBED" arrives before Postgres changes flow; this system message means they do.
        .on('system', {}, (msg: { extension?: string; status?: string; message?: string }) => {
          if (msg.extension !== 'postgres_changes') return;
          if (msg.status === 'ok') {
            setLive(true);
            refetch();
          } else {
            console.warn('Live updates unavailable:', msg.message);
            setLive(false);
          }
        })
        .on<Job>('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs', filter }, ({ new: row }) =>
          setJobs((list) => upsert(list, row, 'updated_at')),
        )
        .on<Job>('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter }, ({ new: row }) =>
          setJobs((list) => upsert(list, row, 'updated_at')),
        )
        .on<Device>('postgres_changes', { event: 'INSERT', schema: 'public', table: 'devices', filter }, ({ new: row }) =>
          setDevices((list) => upsert(list, row, 'last_seen_at')),
        )
        .on<Device>('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices', filter }, ({ new: row }) =>
          setDevices((list) => upsert(list, row, 'last_seen_at')),
        )
        .subscribe((status) => status !== 'SUBSCRIBED' && setLive(false));
    })();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [viewer.id]);

  async function disconnect(device: Device) {
    if (!confirm(`Disconnect “${device.name}”? Its job history on this page is removed too. Nothing on X changes.`)) return;
    const { error } = await createClient().from('devices').delete().eq('id', device.id);
    if (error) return alert(error.message);
    setDevices((list) => list.filter((d) => d.id !== device.id));
    setJobs((list) => list.filter((j) => j.device_id !== device.id));
  }

  const deviceName = new Map(devices.map((d) => [d.id, d.name]));

  return (
    <div className="space-y-10">
      <AccountBar viewer={viewer} live={live} />

      {devices.length === 0 ? (
        <ConnectBrowser email={viewer.email} />
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
                <JobRow key={job.id} job={job} device={deviceName.get(job.device_id)} now={now} />
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
              const online = now - Date.parse(device.last_seen_at) < ONLINE_MS;
              return (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <Laptop className="size-5 text-muted" aria-hidden />
                    <div>
                      <p className="font-medium">{device.name}</p>
                      <p className="text-sm text-muted">
                        <span className={online ? 'text-good-ink' : undefined}>
                          {online ? 'Online' : `Last seen ${ago(device.last_seen_at, now)}`}
                        </span>{' '}
                        · Extension v{device.extension_version}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={() => disconnect(device)} className="btn btn-secondary py-1.5 text-sm">
                    Disconnect
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <DangerZone />
    </div>
  );
}

function AccountBar({ viewer, live }: { viewer: Viewer; live: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {viewer.avatar ? (
          // Google profile pictures; plain <img> keeps the referrer off.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={viewer.avatar} alt="" referrerPolicy="no-referrer" className="size-11 rounded-full" />
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

function ConnectBrowser({ email }: { email: string }) {
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
        Cleanups run in the Xomoni extension on your computer. Sign it in with this account and its jobs appear here
        live.
      </p>
      <ol className="mt-6 space-y-4">
        <Step n={1}>
          <a href={INSTALL_URL} className="text-accent underline underline-offset-2">
            Install the Xomoni extension
          </a>{' '}
          in Chrome, Edge or Brave on your computer.
        </Step>
        <Step n={2}>
          In the extension, open <strong className="font-medium text-ink">Settings → Account</strong> and choose{' '}
          <strong className="font-medium text-ink">Sign in with Google</strong> as{' '}
          <strong className="font-medium text-ink">{email}</strong>.
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

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-medium tabular">
        {n}
      </span>
      <span className="leading-relaxed text-ink-2">{children}</span>
    </li>
  );
}

function JobRow({ job, device, now }: { job: Job; device: string | undefined; now: number }) {
  const state = JOB_STATE[job.state] ?? { label: job.state, tone: 'neutral' as Tone };
  const total = job.kind === 'scan' ? 0 : job.matched;
  const settled = job.done + job.skipped + job.failed;
  const pct = total > 0 ? Math.min(100, Math.round((settled / total) * 100)) : null;

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{job.title}</p>
          <p className="mt-0.5 text-sm text-muted">
            @{job.x_handle}
            {device && ` · ${device}`} · updated {ago(job.updated_at, now)}
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

      {(job.state_reason || job.phase) && (
        <p
          className={`mt-3 flex gap-2 text-sm ${job.state === 'waiting' ? 'text-ink' : 'text-ink-2'}`}
          role={job.state === 'waiting' ? 'alert' : undefined}
        >
          {job.state === 'waiting' && <CircleAlert className="mt-0.5 size-4 shrink-0 text-serious" aria-hidden />}
          {job.state_reason || job.phase}
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

function DangerZone() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    const typed = prompt(
      'This deletes your Xomoni account: connected browsers and job history on this site. Nothing on X is deleted, and the extension keeps working offline.\n\nType DELETE to confirm.',
    );
    if (typed !== 'DELETE') return;
    startTransition(async () => {
      const result = await deleteAccount();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <section className="border-t border-line pt-8" aria-labelledby="danger-title">
      <h2 id="danger-title" className="font-semibold">
        Delete account
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">
        Removes your Xomoni account, connected browsers and job history from our servers. Your X account and
        everything stored in the extension stay as they are.
      </p>
      <button type="button" onClick={onDelete} disabled={pending} className="btn btn-danger mt-4 py-2">
        <Trash className="size-4" aria-hidden />
        {pending ? 'Deleting…' : 'Delete my Xomoni account'}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
    </section>
  );
}

function upsert<T extends { id: string }>(list: T[], row: T, sortKey: keyof T): T[] {
  const next = [row, ...list.filter((item) => item.id !== row.id)];
  return next.sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey])));
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function ago(iso: string, now: number) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}
