import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Archive,
  BellRing,
  Check,
  CircleSlash,
  Gauge,
  KeyRound,
  Laptop,
  ListChecks,
  MousePointerClick,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { GithubMark, SiteFooter, SiteHeader } from '@/components/site-chrome';
import { GITHUB_URL, INSTALL_URL } from '@/lib/site';

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Problems />
        <HowItWorks />
        <Safety />
        <Anywhere />
        <Privacy />
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ id, eyebrow, title, intro, children }: {
  id?: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <p className="text-sm font-medium text-accent">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {intro && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-2">{intro}</p>}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2">
          <span className="size-1.5 rounded-full bg-good" aria-hidden />
          Free · Open source · For your own account
        </p>
        <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Clean up your X history without handing over your password.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-2 text-pretty">
          Xomoni deletes your old posts, replies, reposts and likes from inside your own browser, at a pace X accepts.
          No API keys. No password. Your X session never leaves your computer.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={INSTALL_URL} className="btn btn-primary px-5 py-3 text-base">
            <Laptop className="size-4" aria-hidden />
            Get the extension
          </a>
          <Link href="/login" className="btn btn-secondary px-5 py-3 text-base">
            Sign in to your dashboard
          </Link>
        </div>
        <p className="mt-4 text-sm text-muted">
          For Chrome, Edge and Brave on desktop. Chrome Web Store listing coming soon.
        </p>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-24px_rgba(0,0,0,0.25)]">
          <Image
            src="/screens/overview.png"
            alt="The Xomoni dashboard: removal stats, a year-by-year chart, X’s rate limits and the running job."
            width={1440}
            height={1000}
            priority
            className="h-auto w-full"
          />
        </div>
      </div>
    </section>
  );
}

const PROBLEMS = [
  {
    title: 'The official API is slow and paid',
    body: 'It is pay-per-use, and deleting a post through it is capped at 50 requests every 15 minutes.',
  },
  {
    title: 'Scripts keep breaking',
    body: 'X now requires a signed, single-use anti-bot header on more and more requests. Tools that build their own requests stop working.',
  },
  {
    title: 'Console scripts get accounts flagged',
    body: 'They ignore X’s limits and keep going after X has asked them to stop. That is how accounts get locked.',
  },
];

function Problems() {
  return (
    <Section
      eyebrow="Why it’s hard"
      title="Deleting years of posts on X is harder than it should be."
      intro="X has no “delete everything older than…” button, and every shortcut has a catch."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {PROBLEMS.map((p) => (
          <div key={p.title} className="card p-6">
            <CircleSlash className="size-5 text-critical" aria-hidden />
            <h3 className="mt-4 font-semibold">{p.title}</h3>
            <p className="mt-2 leading-relaxed text-ink-2">{p.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

const STEPS = [
  {
    icon: MousePointerClick,
    title: 'Works in your own X tab',
    body: 'The extension clicks the same buttons you would. X’s own web app sends every request, with all its headers.',
  },
  {
    icon: Archive,
    title: 'Knows what you’ve posted',
    body: 'Import your official X archive or scan your profile. Reaches past the ~3,200-post profile limit.',
  },
  {
    icon: ListChecks,
    title: 'You choose what goes',
    body: 'Pick a date range and keep rules: posts with N+ likes, keywords, links you paste, your own threads. Preview and back up before anything is deleted.',
  },
  {
    icon: Check,
    title: 'Only counts what X confirms',
    body: 'A post is marked removed only when X’s response confirms it. If Xomoni can’t verify an item, it leaves it alone.',
  },
];

function HowItWorks() {
  return (
    <Section
      id="how"
      eyebrow="How it works"
      title="A careful assistant in your browser, not a bot on a server."
      intro="Xomoni never sends its own requests to X. It works the way you do, just more patiently."
    >
      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <li key={s.title} className="card flex gap-4 p-6">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <s.icon className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm text-muted tabular">Step {i + 1}</p>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const DOES = [
  'Reads X’s own rate-limit headers and waits before the window runs out',
  'Backs off on “too many requests” and slows down by itself',
  'Stops the job when X says activity “looks automated”',
  'Waits for you at logins, 2FA and X’s security checks, then continues',
  'Spreads work over hours and days with hourly and daily caps',
];

const NEVER = [
  'Ask for, read or store your X password',
  'Forge X’s headers or send requests of its own',
  'Solve captchas or get around X’s security checks',
  'Use proxies, fake fingerprints or other accounts',
  'Act on a post it can’t verify',
];

function Safety() {
  return (
    <Section
      id="safety"
      eyebrow="Safety"
      title="Works with X’s protections, not against them."
      intro="Your account matters more than speed. When X pushes back, Xomoni listens and slows down or stops."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5 text-good" aria-hidden />
            Xomoni always
          </div>
          <ul className="mt-4 space-y-3">
            {DOES.map((d) => (
              <li key={d} className="flex gap-3 leading-relaxed text-ink-2">
                <Check className="mt-1 size-4 shrink-0 text-good" aria-hidden />
                {d}
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-5 text-critical" aria-hidden />
            Xomoni never
          </div>
          <ul className="mt-4 space-y-3">
            {NEVER.map((d) => (
              <li key={d} className="flex gap-3 leading-relaxed text-ink-2">
                <X className="mt-1 size-4 shrink-0 text-critical" aria-hidden />
                {d}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat icon={Gauge} value="6–12 s" label="between deletes on the default Careful pace" />
        <Stat icon={Gauge} value="150 / hour" label="and 1,000 a day, at most, by default" />
        <Stat icon={BellRing} value="1 hour" label="Xomoni waits for you at a login or 2FA before pausing" />
      </div>
    </Section>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Gauge; value: string; label: string }) {
  return (
    <div className="card p-5">
      <Icon className="size-4 text-muted" aria-hidden />
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular">{value}</p>
      <p className="mt-1 text-sm text-ink-2">{label}</p>
    </div>
  );
}

function Anywhere() {
  return (
    <Section
      eyebrow="Extension + website"
      title="The work happens in your browser. The dashboard goes with you."
      intro="Sign in with the same Google account in the extension and on xomoni.com, then follow your cleanup from any device."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <Laptop className="size-5 text-accent" aria-hidden />
          <h3 className="mt-4 font-semibold">In the extension</h3>
          <p className="mt-2 leading-relaxed text-ink-2">
            Plan a cleanup, preview it, back it up and start it. Deletions only ever run here, in the X tab on your
            computer, and only after you type DELETE.
          </p>
        </div>
        <div className="card p-6">
          <Smartphone className="size-5 text-accent" aria-hidden />
          <h3 className="mt-4 font-semibold">On xomoni.com</h3>
          <p className="mt-2 leading-relaxed text-ink-2">
            See which browsers are connected and how each job is going, live, from your phone or any computer. The
            website can’t start a deletion, so a stolen login can’t wipe your account.
          </p>
        </div>
      </div>
    </Section>
  );
}

const STAYS = ['Your X password and session cookies', 'Your posts, replies and likes', 'Your X archive', 'The activity log'];
const SYNCS = [
  'Your Google name, email and picture',
  'The browsers you connect',
  'Job summaries: type, state and counts',
  'The X handle each job ran on',
];

function Privacy() {
  return (
    <Section
      id="privacy"
      eyebrow="Privacy"
      title="Your posts never touch our servers."
      intro="An account is optional. The extension works fully offline without one; signing in only adds the remote dashboard."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <List title="Stays on your computer" items={STAYS} tone="good" />
        <List title="Synced when you sign in" items={SYNCS} tone="muted" />
      </div>
      <p className="mt-6 text-ink-2">
        Delete your account at any time from the dashboard; everything above goes with it. Read the{' '}
        <Link href="/privacy" className="text-accent underline underline-offset-2">
          privacy policy
        </Link>
        .
      </p>
    </Section>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'muted' }) {
  return (
    <div className="card p-6">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-ink-2">
            <span
              className={`mt-2 size-1.5 shrink-0 rounded-full ${tone === 'good' ? 'bg-good' : 'bg-muted'}`}
              aria-hidden
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

const FAQ = [
  {
    q: 'Is it free?',
    a: 'Yes. Xomoni is free and open source under the MIT license. You can read every line on GitHub.',
  },
  {
    q: 'Does it need my X password?',
    a: 'No. You log in to X yourself, in your own browser, the same way you always do. When X asks for a login or a 2FA code mid-job, Xomoni notifies you, waits, and continues once you’re done.',
  },
  {
    q: 'Can it delete more than 3,200 posts?',
    a: 'Yes. X’s profile page only shows about 3,200 posts, so Xomoni also uses X search and your official X archive to find older ones.',
  },
  {
    q: 'Can my account get restricted?',
    a: 'Any automation on X carries some risk, and no tool can promise otherwise. Xomoni keeps it low: conservative default pacing, X’s own limits, and a full stop when X signals a problem.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'The cleanup runs in Chrome, Edge or Brave on a desktop or laptop. The dashboard on xomoni.com works on any device.',
  },
  {
    q: 'Is Xomoni made by X?',
    a: 'No. Xomoni is an independent project and is not affiliated with, endorsed by or sponsored by X Corp.',
  },
];

function Faq() {
  return (
    <Section eyebrow="FAQ" title="Questions people ask first.">
      <div className="divide-y divide-line border-y border-line">
        {FAQ.map((f) => (
          <details key={f.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {f.q}
              <span className="text-muted transition group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-3 max-w-3xl leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function ClosingCta() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Start with your archive.</h2>
          <p className="mt-2 max-w-xl text-ink-2">
            Request it from X today (Settings → Your account → Download an archive of your data). It can take a day
            to arrive, and it is your backup before anything is deleted.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={INSTALL_URL} className="btn btn-primary px-5 py-3">
            <Laptop className="size-4" aria-hidden />
            Get the extension
          </a>
          <a href={GITHUB_URL} className="btn btn-secondary px-5 py-3">
            <GithubMark className="size-4" />
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
