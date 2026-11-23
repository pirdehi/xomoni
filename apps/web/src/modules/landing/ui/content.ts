// The landing page's words and icons, kept apart from its layout so copy changes don't touch the components. What
// Xomoni is (the pillars and the places) lives in `domain/footprint.ts`; this file holds the rest.
import {
  Archive24Regular,
  Broom24Regular,
  ChatMultiple24Regular,
  CheckmarkStarburst24Regular,
  Clock24Regular,
  CursorClick24Regular,
  DataTrending24Regular,
  type FluentIcon,
  Gauge24Regular,
  Globe24Regular,
  History24Regular,
  LockClosed24Regular,
  Mail24Regular,
  Person24Regular,
  PersonVoice24Regular,
  QuestionCircle24Regular,
  Search24Regular,
  ShieldCheckmark24Regular,
  Sparkle24Regular,
  TaskListLtr24Regular,
  Timer24Regular,
} from '@fluentui/react-icons';
import type { Pillar } from '../domain/footprint';

/** A titled card on the landing page, with its icon. */
export interface Feature {
  icon: FluentIcon;
  title: string;
  body: string;
}

/** The short promises under the hero's buttons. Each is true today, on X. */
export const HERO_FACTS = [
  'No X password, no API keys',
  'Your posts stay on your computer',
  'You approve every deletion',
  'Free and open source',
];

/**
 * The one line about risk near the top, which the Safety section, the install guide and `/risks` repeat in their own
 * words (`@xomoni/consent`): X's rules forbid automating its website, and Xomoni lowers the risk without removing it.
 */
export const RISK_LINE =
  'Acting on X carries a risk: X’s rules forbid automating its website. Xomoni keeps that risk low, but no tool can remove it.';

/** Each pillar's icon: generic Fluent icons, never a platform's logo. */
export const PILLAR_ICONS: Readonly<Record<Pillar, FluentIcon>> = {
  discover: Search24Regular,
  understand: DataTrending24Regular,
  clean: Broom24Regular,
  protect: ShieldCheckmark24Regular,
  shape: Sparkle24Regular,
};

const PLACE_ICONS: Readonly<Record<string, FluentIcon>> = {
  x: ChatMultiple24Regular,
  email: Mail24Regular,
};

/**
 * A place's icon, by `Place.id`: a generic Fluent icon, never a platform's logo (the brand rule: platforms are named in
 * words only). A place without its own icon gets the globe.
 */
export function placeIcon(id: string): FluentIcon {
  return PLACE_ICONS[id] ?? Globe24Regular;
}

/** How Xomoni works on X, in four steps. */
export const STEPS: Feature[] = [
  {
    icon: CursorClick24Regular,
    title: 'Works in your own X tab',
    body: 'The extension clicks the same buttons you would. X’s own web app sends every request, with all its headers.',
  },
  {
    icon: Archive24Regular,
    title: 'Knows what you’ve posted',
    body: 'Import your official X archive or scan your profile. Reaches past the ~3,200-post profile limit.',
  },
  {
    icon: TaskListLtr24Regular,
    title: 'You choose what goes',
    body: 'Pick a date range and keep rules: posts with N+ likes, keywords, links you paste, your own threads. Preview and back up before anything is deleted.',
  },
  {
    icon: CheckmarkStarburst24Regular,
    title: 'Only counts what X confirms',
    body: 'A post is marked removed only when X’s response confirms it. If Xomoni can’t verify an item, it leaves it alone.',
  },
];

/**
 * The principles Xomoni keeps in every place it works, today and later. They say *limits*, not *rules*: on X, Xomoni
 * stays within X's limits and protections, but X's rules forbid automating its website (`RISK_LINE`).
 */
export const PRINCIPLES: Feature[] = [
  {
    icon: Person24Regular,
    title: 'You decide',
    body: 'Xomoni acts only on what you asked for, deletes nothing until you confirm, and stops when you say so.',
  },
  {
    icon: Gauge24Regular,
    title: 'Within the limits, never around them',
    body: 'No forged requests, solved captchas, proxies or hiding that it is automation. On X, at most one fifth of any limit X announces.',
  },
  {
    icon: LockClosed24Regular,
    title: 'Your data stays with you',
    body: 'Your posts and likes stay on your computer, and Xomoni never asks for your X password or cookies. Our servers hold your account and job status, and your daily numbers only if you turn them on.',
  },
  {
    icon: History24Regular,
    title: 'Everything on the record',
    body: 'Every action goes into an activity log on your computer, which you can read and export.',
  },
  {
    icon: QuestionCircle24Regular,
    title: 'When in doubt, it leaves it',
    body: 'If Xomoni can’t verify an item, it doesn’t touch it.',
  },
  {
    icon: PersonVoice24Regular,
    title: 'Your name, your voice',
    body: 'Xomoni never posts, replies or writes anything in your name.',
  },
];

/** What Xomoni always does on X, to stay within X's limits. */
export const ALWAYS = [
  'Reads X’s own rate-limit headers and waits before the window runs out',
  'Backs off on “too many requests” and slows down by itself',
  'Stops the job when X says activity “looks automated”',
  'Waits for you at logins, 2FA and X’s security checks, then continues',
  'Spreads work over hours and days with hourly and daily caps',
];

/** What Xomoni never does on X (ADR-0003). */
export const NEVER = [
  'Ask for, read or store your X password',
  'Forge X’s headers or send requests of its own',
  'Solve captchas or get around X’s security checks',
  'Use proxies, fake fingerprints or other accounts',
  'Act on a post it can’t verify',
];

/**
 * The default pace on X, in numbers: the extension's Careful preset for deletes (`apps/extension/src/shared/settings.ts`,
 * one fifth of X's limits, ADR-0012). Change these with it: `apps/extension/tests/landing-claims.test.ts` reads this
 * file and fails when they drift apart.
 */
export const LIMITS = [
  { icon: Timer24Regular, value: '80–120 s', label: 'between deletes on the default Careful pace' },
  { icon: Gauge24Regular, value: '40 / hour', label: 'and 960 a day, at most, by default' },
  { icon: Clock24Regular, value: '1 hour', label: 'Xomoni waits for you at a login or 2FA before pausing' },
];

/** What never leaves the person's computer (ADR-0004). */
export const STAYS = [
  'Your X password and session cookies',
  'Your posts, replies and likes',
  'Your X archive',
  'The activity log',
];

/** What reaches xomoni.com once the person signs in. */
export const SYNCS = [
  'Your email address and name, or your Google profile',
  'The browsers you connect',
  'Job summaries: type, state and counts',
  'The X handle each job ran on',
  'Daily numbers, only if you turn them on: counts per day, never your posts',
];

/** A question people ask first, its answer, and a page to read more on, if any. */
export interface Question {
  q: string;
  a: string;
  more?: { label: string; href: string };
}

/** The questions people ask first, with their answers. */
export const FAQ: Question[] = [
  {
    q: 'What is a digital footprint manager?',
    a: 'A tool for what the internet holds of you: what you have posted and liked over the years, what people see of you, and what you want them to see. Xomoni helps you find it, understand it, clean up what no longer fits, protect yourself and shape what stays, one place at a time, from your own computer.',
  },
  {
    q: 'Which places does Xomoni work in?',
    a: 'X, today. Your email is planned next, and other places later, with no dates yet. Today Xomoni works only on X: it doesn’t open your email or any other account.',
  },
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
    q: 'Why not use X’s API or a script?',
    a: 'X’s official API is pay-per-use, and deleting a post through it is capped at 50 requests every 15 minutes. Scripts that build their own requests keep breaking, because X now requires a signed, single-use anti-bot header on more and more of them. Console scripts ignore X’s limits and keep going after X has asked them to stop, which is how accounts get locked. Xomoni clicks X’s own buttons in your browser instead, well below X’s limits.',
  },
  {
    q: 'Can my account get restricted?',
    a: 'It can. X’s rules forbid automating its website, and only X decides what happens to an account. Xomoni keeps the risk low: it uses at most one fifth of any limit X announces, starts slower than that, and stops at X’s first warning. It can’t make the risk zero.',
    more: { label: 'Read the risks', href: '/risks' },
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
