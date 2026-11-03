// The landing page's words, kept apart from its layout so copy changes don't touch the components.
import {
  Archive24Regular,
  CheckmarkStarburst24Regular,
  Clock24Regular,
  CursorClick24Regular,
  ErrorCircle24Regular,
  Gauge24Regular,
  type FluentIcon,
  Prohibited24Regular,
  ShieldError24Regular,
  TaskListLtr24Regular,
  Timer24Regular,
} from '@fluentui/react-icons';

/** A titled card on the landing page, with its icon. */
export interface Feature {
  icon: FluentIcon;
  title: string;
  body: string;
}

/** The short promises under the hero's buttons. */
export const HERO_FACTS = ['No X password', 'No API keys', 'Runs in your browser', 'Free and open source'];

/** Why deleting old posts is hard today: the three shortcuts and their catch. */
export const PROBLEMS: Feature[] = [
  {
    icon: ErrorCircle24Regular,
    title: 'The official API is slow and paid',
    body: 'It is pay-per-use, and deleting a post through it is capped at 50 requests every 15 minutes.',
  },
  {
    icon: ShieldError24Regular,
    title: 'Scripts keep breaking',
    body: 'X now requires a signed, single-use anti-bot header on more and more requests. Tools that build their own requests stop working.',
  },
  {
    icon: Prohibited24Regular,
    title: 'Console scripts get accounts flagged',
    body: 'They ignore X’s limits and keep going after X has asked them to stop. That is how accounts get locked.',
  },
];

/** How Xomoni works, in four steps. */
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

/** What Xomoni always does to stay within X's limits. */
export const ALWAYS = [
  'Reads X’s own rate-limit headers and waits before the window runs out',
  'Backs off on “too many requests” and slows down by itself',
  'Stops the job when X says activity “looks automated”',
  'Waits for you at logins, 2FA and X’s security checks, then continues',
  'Spreads work over hours and days with hourly and daily caps',
];

/** What Xomoni never does (ADR-0003). */
export const NEVER = [
  'Ask for, read or store your X password',
  'Forge X’s headers or send requests of its own',
  'Solve captchas or get around X’s security checks',
  'Use proxies, fake fingerprints or other accounts',
  'Act on a post it can’t verify',
];

/** The default pacing, in numbers. */
export const LIMITS = [
  { icon: Timer24Regular, value: '6–12 s', label: 'between deletes on the default Careful pace' },
  { icon: Gauge24Regular, value: '150 / hour', label: 'and 1,000 a day, at most, by default' },
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
];

/** The questions people ask first, with their answers. */
export const FAQ = [
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
