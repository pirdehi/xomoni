// Reading a version's release issue (#340, ADR-0037): the checklist opened from .github/ISSUE_TEMPLATE/release.md,
// which the release workflow reads before it publishes. Kept apart from the command line in
// tooling/check-release-issue.mjs, with no I/O, so tooling/release-issue.test.mjs can test it.
import { versionOfTag } from './release-lib.mjs';

/** The label every release issue carries, set by the Release template. */
export const RELEASE_LABEL = 'release';

/** The heading of the section whose boxes must all be ticked before a release goes out. Other sections don't count. */
export const BEFORE_THE_TAG = 'Before the tag';

/**
 * Who may open a release issue that counts, as GitHub's `author_association` says: the owner, and people who can push
 * to the repository. The template labels an issue `release` for anyone who opens it, so without this anyone could
 * open, and tick, the checklist of a release; only its author and people with push access can edit it.
 */
export const TRUSTED_AUTHORS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** The problem with `tag` as a release tag, or null when it is `v<major>.<minor>.<patch>`. */
export const tagProblem = (tag) =>
  versionOfTag(tag) ? null : `The tag ${String(tag)} is not v<major>.<minor>.<patch>.`;

/** The title of the release issue for `tag`, such as `Release v0.5.0`. It must match exactly. */
export const releaseIssueTitle = (tag) => `Release ${tag}`;

/**
 * Splits `issues` into `tag`'s release issues and the ones that would be but were opened by someone without push
 * access (`untrusted`). A release issue is an open issue, not a pull request, labelled `release` and titled exactly
 * `Release vX.Y.Z`. `issues` are as GitHub's REST API lists them (`GET /repos/{owner}/{repo}/issues`); the check asks
 * for open `release` issues only, and this filters again so nothing else can pass for one.
 */
export function matchingReleaseIssues(issues, tag) {
  const title = releaseIssueTitle(tag);
  const candidates = issues.filter(
    (issue) =>
      issue.pull_request == null &&
      Number.isInteger(issue.number) &&
      issue.title === title &&
      String(issue.state).toLowerCase() === 'open' &&
      (issue.labels ?? []).some((label) => (typeof label === 'string' ? label : label.name) === RELEASE_LABEL),
  );
  return {
    trusted: candidates.filter((issue) => TRUSTED_AUTHORS.includes(issue.author_association)),
    untrusted: candidates.filter((issue) => !TRUSTED_AUTHORS.includes(issue.author_association)),
  };
}

/**
 * `markdown` without what GitHub doesn't render as text: HTML comments, which the template uses for its notes, and
 * fenced code blocks. A box inside either is no checkbox on the issue's page, so it must not count here either.
 * Windows line endings become `\n`.
 */
function renderedText(markdown) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, '');
}

/** A Markdown heading of level 1 or 2, which ends the section before it; `###` and below stay inside it. */
const SECTION_HEADING = /^ {0,3}#{1,2}(?!#)(?:[ \t]+(.*?))?[ \t#]*$/;
/** A task list item, as GitHub renders one: `- [ ] text`, `* [x] text`, `1. [X] text`, at any depth. */
const CHECKBOX = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;

/**
 * The checkboxes under `## Before the tag` in an issue's `body`, up to the next heading of level 1 or 2, or null when
 * there is no such section. Each box has `ticked` and its `text`, trimmed. Boxes in HTML comments or code blocks
 * aren't boxes, and neither is anything in another section.
 */
export function beforeTheTagBoxes(body) {
  const lines = renderedText(body ?? '').split('\n');
  const start = lines.findIndex((line) => SECTION_HEADING.exec(line)?.[1]?.trim() === BEFORE_THE_TAG);
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && SECTION_HEADING.test(line));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .map((line) => CHECKBOX.exec(line))
    .filter((match) => match != null)
    .map(([, mark, text]) => ({ ticked: mark !== ' ', text: (text ?? '').trim() }));
}

/**
 * Whether `tag` may be released, judged from the open issues `issues` (see `matchingReleaseIssues`).
 *
 * Returns every problem at once, not only the first: a tag that isn't `vX.Y.Z`; no release issue, or more than one;
 * no `## Before the tag` section, or no box in it; and each unticked box there, whose texts are also in `unticked`.
 * `issue` is the release issue, with its `number` and `url`, whenever exactly one was found, even with problems; null
 * otherwise. `ticked` counts the ticked boxes. Ready when `problems` is empty.
 */
export function releaseIssueReadiness(issues, tag) {
  const result = (problems, issue = null, unticked = [], ticked = 0) => ({ problems, issue, unticked, ticked });
  const badTag = tagProblem(tag);
  if (badTag) return result([badTag]);
  const title = releaseIssueTitle(tag);
  const { trusted, untrusted } = matchingReleaseIssues(issues, tag);
  if (trusted.length === 0) {
    const ignored = untrusted.length
      ? ` ${untrusted.map((issue) => `#${issue.number}`).join(', ')} doesn't count: opened by someone who can't push to the repository.`
      : '';
    return result([
      `No open issue labelled "${RELEASE_LABEL}" is titled "${title}". Open it from the Release template and tick its boxes (docs/RELEASING.md, step 0).${ignored}`,
    ]);
  }
  if (trusted.length > 1) {
    const numbers = trusted.map((issue) => `#${issue.number}`).join(', ');
    return result([`${trusted.length} open issues are titled "${title}" (${numbers}). Keep one and close the others.`]);
  }
  const [{ number, html_url: url, body }] = trusted;
  const issue = { number, url };
  const boxes = beforeTheTagBoxes(body);
  if (boxes == null)
    return result([`#${number} has no "## ${BEFORE_THE_TAG}" section. Open it from the Release template.`], issue);
  if (boxes.length === 0)
    return result(
      [`#${number} has no checkbox under "## ${BEFORE_THE_TAG}". Open it from the Release template.`],
      issue,
    );
  const unticked = boxes.filter((box) => !box.ticked).map((box) => box.text || '(a box with no text)');
  const problems = unticked.map((text) => `#${number}: unticked under "${BEFORE_THE_TAG}": ${text}`);
  return result(problems, issue, unticked, boxes.length - unticked.length);
}
