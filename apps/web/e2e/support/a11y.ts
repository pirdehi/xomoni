import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/** The impacts that fail a test. Minor and moderate findings are reported by axe but don't fail it. */
const FAILING = new Set(['serious', 'critical']);

/** How many times axe looks before a violation counts: a real one is there every time. */
const LOOKS = 3;

/** What to leave out of a check, each with the reason in a comment where it is used. */
export interface A11yOptions {
  /** CSS selectors of parts of the page not to check, such as a third party's frame. */
  exclude?: string[];
  /** Fail the test at its end rather than at once, so a sweep of many pages reports every page's violations. */
  soft?: boolean;
}

/**
 * Resolves once the page's DOM has not changed for `quietMs` and no transition is running, or after `maxMs` at most.
 * A page still loading its data re-renders while axe reads it, and a control caught between two states (disabled, then
 * enabled, its colors fading from one to the other) would fail or pass by chance. A spinner, which never ends, and a
 * clock that ticks every few seconds still let it settle.
 */
async function settled(page: Page, quietMs = 300, maxMs = 3000): Promise<void> {
  await page.evaluate(
    ([quiet, max]) =>
      new Promise<void>((resolve) => {
        const moving = () =>
          document
            .getAnimations()
            .some((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime));
        const wait = () => setTimeout(() => (moving() ? (timer = wait()) : done()), quiet);
        let timer = wait();
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = wait();
        });
        const cap = setTimeout(done, max);
        function done() {
          observer.disconnect();
          clearTimeout(timer);
          clearTimeout(cap);
          resolve();
        }
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      }),
    [quietMs, maxMs] as const,
  );
}

/** Each serious or critical violation, with up to five of the elements it found and why: enough to fix it from CI's log. */
function describe(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']): string[] {
  return violations
    .filter((v) => v.impact != null && FAILING.has(v.impact))
    .map((v) => {
      const nodes = v.nodes.slice(0, 5).map((node) => {
        const why = node.failureSummary?.split('\n').slice(1).join(' ').trim();
        return `${node.target.join(' ')}${why ? `: ${why}` : ''}`;
      });
      const more = v.nodes.length > nodes.length ? [`and ${String(v.nodes.length - nodes.length)} more`] : [];
      return [`${v.id} (${String(v.impact)}): ${v.help}. ${v.helpUrl}`, ...nodes, ...more].join('\n  ');
    });
}

/**
 * Fails the test when axe-core finds any serious or critical accessibility violation on the page as it is now
 * (#342, ADR-0038's `a11y` category). Every rule axe runs by default is checked: WCAG 2.0 to 2.2 at A and AA, and
 * axe's best practices. The message lists each rule with the elements it found; the full results are attached to
 * the test's report as `axe-<n>.json`.
 * Call it once the page shows the state to check (an open dialog, an error shown, a step of a guide). It waits for the
 * page to settle before it looks, and looks again when it finds something, in case the page was still changing; only
 * what it finds every time fails the test.
 */
export async function expectNoSeriousA11yViolations(page: Page, options: A11yOptions = {}): Promise<void> {
  // Tabster's focus sentinels, which Fluent puts around dialogs, menus and focus groups: empty, and focusable only to
  // pass the focus on at once. axe reports each as aria-hidden yet focusable, though no one can rest on it.
  const exclude = ['[data-tabster-dummy]', ...(options.exclude ?? [])];
  let violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'] = [];
  for (let look = 1; look <= LOOKS; look++) {
    await settled(page);
    const builder = exclude.reduce((b, selector) => b.exclude(selector), new AxeBuilder({ page }));
    ({ violations } = await builder.analyze());
    if (describe(violations).length === 0) break;
  }

  const info = test.info();
  const index = info.attachments.filter((a) => a.name.startsWith('axe-')).length + 1;
  await info.attach(`axe-${String(index)}.json`, {
    body: JSON.stringify({ url: page.url(), violations }, null, 2),
    contentType: 'application/json',
  });
  (options.soft ? expect.soft : expect)(
    describe(violations),
    `serious or critical accessibility violations on ${page.url()}`,
  ).toEqual([]);
}
