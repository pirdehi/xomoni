// Which parts of Xomoni will be on the Plus plan (#425, ADR-0042), named before payments come, so the dashboard can
// say so now. Nothing is locked: until the plan arrives from xomoni.com (#423), every account is on `preview`, and every
// feature works. No network, no storage: pure.

/**
 * The parts R1 puts on the Plus plan: Reach diagnosis's history, comparisons, suspected posts, the new-label alert,
 * and Reach on xomoni.com (#428 to #431). The ids are `@xomoni/entitlements`' `FEATURES` (#420), which take over once
 * the plan comes from the cloud. Taking one's data out, deleting it, moving it and every safety rail are never here.
 */
export const PLUS_FEATURES = [
  'reach-history',
  'reach-compare',
  'reach-suspects',
  'reach-alerts',
  'reach-website',
] as const;

/** One of `PLUS_FEATURES`. */
export type PlusFeature = (typeof PLUS_FEATURES)[number];

/** Whether `feature` will be on the Plus plan. */
export const isPlusFeature = (feature: string): feature is PlusFeature =>
  (PLUS_FEATURES as readonly string[]).includes(feature);

/**
 * The plan an account is on, as the dashboard shows it: `preview` until payments come (#423), with every feature open.
 */
export type PlanView = 'preview';

/** The plan the dashboard shows: always `preview` for now, so nothing is ever locked. Asks nothing of any server. */
export function planOf(): PlanView {
  return 'preview';
}
