// What Xomoni is, as the home page tells it (#313): a digital footprint manager. The five things it does in every place
// it covers, and those places, each with where it stands. A place Xomoni doesn't work in yet carries no feature and no
// date, so the page can't promise either. Pure: the words and the rules, no React.

/** The five things Xomoni does in every place it covers, in the order the home page tells them. */
export const PILLARS = ['discover', 'understand', 'clean', 'protect', 'shape'] as const;

/** One of the five things Xomoni does: discover, understand, clean up, protect or shape a footprint. */
export type Pillar = (typeof PILLARS)[number];

/** A pillar in words that hold for every place: its name and what it means. */
export interface PillarText {
  name: string;
  summary: string;
}

/** Each pillar's name and meaning. What it does in a given place is that place's `does`. */
export const PILLAR_TEXT: Readonly<Record<Pillar, PillarText>> = {
  discover: { name: 'Discover', summary: 'See what of you is out there, and where.' },
  understand: { name: 'Understand', summary: 'Your numbers, how they change, and what stands out.' },
  clean: { name: 'Clean up', summary: 'Remove what no longer speaks for you, with a copy kept first.' },
  protect: { name: 'Protect', summary: 'Notice what is said and how your account is doing, before it hurts.' },
  shape: { name: 'Shape', summary: 'Keep what you want to be seen, in your own voice.' },
};

/**
 * Where a place stands: Xomoni works there `today`, it is the one planned `next`, or it comes `later`. There are no
 * dates on purpose: nothing beyond X is scheduled.
 */
export type PlaceStatus = 'today' | 'next' | 'later';

/** The statuses in the order the page shows them. */
export const PLACE_STATUSES: readonly PlaceStatus[] = ['today', 'next', 'later'];

/** The badge each status shows. */
export const STATUS_LABEL: Readonly<Record<PlaceStatus, string>> = { today: 'Today', next: 'Next', later: 'Later' };

interface PlaceBase {
  /** A stable key for the page, never shown. */
  id: string;
  /** The place in plain words. No logo goes with it (the brand rule: platform names only in text). */
  name: string;
  summary: string;
}

/** A place Xomoni works in today, with what it does there for each pillar: only features that exist and ship. */
export interface AvailablePlace extends PlaceBase {
  status: 'today';
  does: Readonly<Record<Pillar, string>>;
}

/** A place that is planned. It can't name a feature (`does`), because none is built yet. */
export interface PlannedPlace extends PlaceBase {
  status: 'next' | 'later';
  does?: never;
}

/** A place where a person is present, is seen or wants to be seen, as far as Xomoni is concerned. */
export type Place = AvailablePlace | PlannedPlace;

/**
 * The places, in order: X today, the person's email next, then the rest. X's lines name only what the extension and
 * xomoni.com do today (the Library, the yearly counts and the insights from daily numbers, Cleanup, Watch, Account
 * health, Comments); change them with the product.
 */
export const PLACES: readonly Place[] = [
  {
    id: 'x',
    name: 'X',
    status: 'today',
    summary: 'Your posts, replies, reposts and likes. In Chrome, Edge and Brave on a computer.',
    does: {
      discover: 'The Library: every post, reply, repost and like Xomoni knows, from X’s archive and your profile.',
      understand: 'Your posts year by year and, if you turn on daily numbers, your followers and engagement over time.',
      clean: 'Delete old posts, replies and reposts and undo likes, by date, with rules for what to keep.',
      protect: 'Watch follows the phrases and #hashtags you pick; Account health shows X’s warnings and Xomoni’s pace.',
      shape: 'Your replies and the replies you get, in one place. Xomoni never posts in your name.',
    },
  },
  {
    id: 'email',
    name: 'Your email',
    status: 'next',
    summary: 'Planned next, and not available yet: today Xomoni doesn’t open or read your email.',
  },
  {
    id: 'everywhere',
    name: 'Everywhere else you are',
    status: 'later',
    summary:
      'Then the other places you are present, are seen or want to be seen: one at a time, on the same principles.',
  },
];

/** Whether Xomoni works in `place` today, so the page may say what it does there. */
export function isAvailable(place: Place): place is AvailablePlace {
  return place.status === 'today';
}

/** `places` by status, today first, then next, then later; places with the same status keep their order. */
export function inStatusOrder(places: readonly Place[]): Place[] {
  return PLACE_STATUSES.flatMap((status) => places.filter((place) => place.status === status));
}

/** What a pillar does today in one place: a line under the pillar on the home page. */
export interface PillarExample {
  place: string;
  text: string;
}

/**
 * What `pillar` does today, in each place Xomoni works in today, in order. A planned place adds nothing, so the page
 * never shows a feature that doesn't exist.
 */
export function examplesOf(pillar: Pillar, places: readonly Place[] = PLACES): PillarExample[] {
  return places.filter(isAvailable).map((place) => ({ place: place.name, text: place.does[pillar] }));
}
