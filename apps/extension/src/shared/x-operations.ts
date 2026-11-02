// The names of X's GraphQL operations Xomoni reads. One list for the page-world interceptor (which forwards
// only these) and the content script (which parses them), so the two can't drift apart (#61). Pure data:
// the interceptor runs inside X's page, so this file must stay free of other imports.

/** GraphQL operations whose responses carry timeline posts for the inventory. */
export const TIMELINE_OPS: ReadonlySet<string> = new Set([
  'UserTweets',
  'UserTweetsAndReplies',
  'Likes',
  'SearchTimeline',
  'TweetDetail',
]);

/** Write operations whose responses confirm an action the actor performed. */
export const MUTATION_OPS: ReadonlySet<string> = new Set([
  'DeleteTweet',
  'DeleteRetweet',
  'FavoriteTweet',
  'UnfavoriteTweet',
]);

/** Operations whose responses carry a user's profile. */
export const PROFILE_OPS: ReadonlySet<string> = new Set(['UserByScreenName']);

/** Every operation the interceptor forwards to the content script. */
export const WATCHED_OPS: ReadonlySet<string> = new Set([...TIMELINE_OPS, ...MUTATION_OPS, ...PROFILE_OPS]);
