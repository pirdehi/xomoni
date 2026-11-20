// The dashboard's places (#245, docs/DASHBOARD-PLAN-2026-11-19.md): one list, in the order the menu shows them, with
// the words each place uses for itself. Pure.
import type { XomoniPage } from '@xomoni/bridge';

/** A place of the dashboard; also its address under `/dashboard`. */
export type SectionId =
  | 'overview'
  | 'audience'
  | 'content'
  | 'engagement'
  | 'reports'
  | 'library'
  | 'comments'
  | 'cleanup'
  | 'watch'
  | 'activity'
  | 'health'
  | 'browsers'
  | 'settings';

/** The menu's groups. */
export type SectionGroup = 'overview' | 'insights' | 'manage' | 'history';

/** One place of the dashboard. */
export interface Section {
  id: SectionId;
  group: SectionGroup;
  /** The menu's word for it, the same as the extension's where the extension has the place. */
  label: string;
  /** One sentence: what the place is for. */
  summary: string;
  /** What it will show, for a place not built yet. */
  shows: readonly string[];
  /** Where its data comes from, in the person's words. */
  source: string;
  /** Its lists and actions come from Xomoni in this browser (ADR-0027); its numbers may still come from the cloud. */
  needsXomoni: boolean;
  /** Built: false shows what the place will hold instead of an empty page (no empty wall). */
  ready: boolean;
  /** The issue that builds it, for a place not built yet. */
  issue?: number;
}

/** The groups' headings, in menu order. */
export const GROUPS: readonly { id: SectionGroup; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'insights', label: 'Insights' },
  { id: 'manage', label: 'Manage' },
  { id: 'history', label: 'History & account' },
];

const DAILY_NUMBERS = 'Daily numbers from Xomoni on your computer, if you turn them on';

/** Every place, in menu order. */
export const SECTIONS: readonly Section[] = [
  {
    id: 'overview',
    group: 'overview',
    label: 'Overview',
    summary: 'How your account is doing, what runs, and what needs you.',
    shows: [],
    source: 'Xomoni’s jobs, and daily numbers once you turn them on',
    needsXomoni: false,
    ready: true,
  },
  {
    id: 'audience',
    group: 'insights',
    label: 'Audience',
    summary: 'Who follows you, and how that changes.',
    shows: [
      'Followers and following over time',
      'Followers gained and lost each day',
      'Milestones, and your follower to following ratio',
      'Who followed or unfollowed you between two archives',
    ],
    source: DAILY_NUMBERS,
    needsXomoni: false,
    ready: true,
  },
  {
    id: 'content',
    group: 'insights',
    label: 'Content',
    summary: 'What you publish, and what still stands.',
    shows: [
      'Posts, replies, reposts and quotes published each day and week',
      'Your best day and hour to post',
      'Your top posts, and posts no one engaged with',
      'How old the posts still online are',
    ],
    source: 'Your X archive and what Xomoni has seen',
    needsXomoni: false,
    ready: true,
  },
  {
    id: 'engagement',
    group: 'insights',
    label: 'Engagement',
    summary: 'How people respond to what you post.',
    shows: [
      'Likes, replies, reposts, quotes and views received each day',
      'How many of your posts and replies got likes',
      'Your engagement rate, and your most-liked replies',
    ],
    source: DAILY_NUMBERS,
    needsXomoni: false,
    ready: true,
  },
  {
    id: 'reports',
    group: 'insights',
    label: 'Reports',
    summary: 'Your account in one page, to keep or share.',
    shows: [
      'Weekly and monthly reports, and your year in review',
      'A cleanup report: what was removed, and when',
      'Your own report: any numbers, any period',
      'CSV and PDF, and a weekly email if you want one',
    ],
    source: DAILY_NUMBERS,
    needsXomoni: false,
    ready: false,
    issue: 257,
  },
  {
    id: 'library',
    group: 'manage',
    label: 'Library',
    summary: 'Every post, reply, repost and like Xomoni knows.',
    shows: ['Search and filter everything', 'Pick what to clean up', 'Download your copy'],
    source: 'Xomoni on this computer: your posts never reach our servers',
    needsXomoni: true,
    ready: true,
  },
  {
    id: 'comments',
    group: 'manage',
    label: 'Comments',
    summary: 'Your replies, and the replies you get.',
    shows: [
      'Your replies, by date, likes, who you replied to and words',
      'Replies to you each day, and who replies most',
      'Pick your replies to clean up; open others on X to hide them',
    ],
    source: 'Xomoni on this computer: your posts never reach our servers',
    needsXomoni: true,
    ready: true,
    issue: 256,
  },
  {
    id: 'cleanup',
    group: 'manage',
    label: 'Cleanup',
    summary: 'Plan what to remove; Xomoni does it, at a careful pace.',
    shows: [],
    source: 'Xomoni on this computer, which asks you before it starts',
    needsXomoni: true,
    ready: true,
  },
  {
    id: 'watch',
    group: 'manage',
    label: 'Watch',
    summary: 'Phrases and mentions you follow on X.',
    shows: ['The newest posts for each phrase or #hashtag', 'Mentions of you each day'],
    source: 'Xomoni on this computer, while it watches',
    needsXomoni: true,
    ready: true,
  },
  {
    id: 'activity',
    group: 'history',
    label: 'Activity',
    summary: 'Every job, what it did, and when.',
    shows: [],
    source: 'Xomoni’s jobs, from every browser you connected',
    needsXomoni: false,
    ready: true,
  },
  {
    id: 'health',
    group: 'history',
    label: 'Account health',
    summary: 'How careful Xomoni is being with your account right now.',
    shows: ['Your account’s risk level and X’s warnings', 'Today’s pace against X’s limits'],
    source: 'Xomoni on this computer',
    needsXomoni: true,
    ready: true,
  },
  {
    id: 'browsers',
    group: 'history',
    label: 'Browsers',
    summary: 'The browsers where Xomoni works for this account.',
    shows: [],
    source: 'Your connected browsers',
    needsXomoni: false,
    ready: true,
  },
  {
    id: 'settings',
    group: 'history',
    label: 'Settings',
    summary: 'Xomoni’s pace, safety and notifications, applied on your computer.',
    shows: [],
    source: 'Xomoni on this computer',
    needsXomoni: true,
    ready: true,
  },
];

/** The place an address names (`undefined` is Overview), or null for one that doesn't exist. */
export function sectionFromSlug(slug: string | undefined): Section | null {
  const id = slug ?? 'overview';
  return SECTIONS.find((section) => section.id === id) ?? null;
}

/** The address of a place, keeping the account and period (`query`, without `?`). */
export function sectionHref(id: SectionId, query = ''): string {
  const path = id === 'overview' ? '/dashboard' : `/dashboard/${id}`;
  return query ? `${path}?${query}` : path;
}

const XOMONI_PAGE: Partial<Record<SectionId, XomoniPage>> = {
  library: 'library',
  comments: 'library',
  cleanup: 'cleanup',
  watch: 'watch',
  health: 'overview',
  settings: 'settings',
};

/**
 * The page of Xomoni that holds a place's lists and actions today (ADR-0027), for *Open in Xomoni*; null for a place
 * that doesn't need Xomoni. Comments live in Xomoni's Library, and account health on its Home.
 */
export function xomoniPageFor(id: SectionId): XomoniPage | null {
  return XOMONI_PAGE[id] ?? null;
}
