/**
 * How much of an account Xomoni can see (PLAYBOOK E2, C6). X search leaves out posts older than about a week
 * that have no likes, and the profile timeline shows only the newest ~3,200 posts, so the archive is the only
 * complete source. Pure.
 */

/** About how many posts X's profile timeline shows, newest first. Older ones need search or the archive. */
export const PROFILE_TIMELINE_LIMIT = 3200;

/** The smallest gap between X's count and the inventory worth telling the person about. */
const UNSEEN_MIN = 20;

/**
 * About how many of the account's posts, replies and reposts X has but the inventory doesn't, or null when X's
 * count is unknown or too old to compare. `postsCount` is X's count when its profile was last seen;
 * `removedSinceProfile` are the items Xomoni removed after that, which X's count still includes.
 */
export function unseenPosts(input: {
  postsCount: number | null;
  profileSeen: boolean;
  present: number;
  removedSinceProfile: number;
}): number | null {
  if (input.postsCount == null || !input.profileSeen) return null;
  return Math.max(0, input.postsCount - input.removedSinceProfile - input.present);
}

/** Whether a gap is worth a warning: more than 20 posts and more than 2% of X's count. */
export function worthWarning(unseen: number | null, postsCount: number | null): unseen is number {
  return unseen != null && unseen > UNSEEN_MIN && unseen > (postsCount ?? 0) * 0.02;
}
