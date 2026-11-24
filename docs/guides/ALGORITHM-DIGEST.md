# Publishing the algorithm digest

Each month, Xomoni publishes a short digest of what changed in X's open-source ranking code, at [xomoni.com/algorithm](https://xomoni.com/algorithm). A workflow drafts it from public code only; a maintainer writes it and publishes it. The decision is [ADR-0046](../adr/0046-a-public-digest-of-xs-open-ranking-code.md); the issue is [#430](https://github.com/pirdehi/xomoni/issues/430).

## What the workflow does

On the 20th of each month, [`algorithm-digest.yml`](../../.github/workflows/algorithm-digest.yml) runs [`tooling/algorithm-digest.mjs`](../../tooling/algorithm-digest.mjs). It reads X's public repository [`xai-org/x-algorithm`](https://github.com/xai-org/x-algorithm) through GitHub's REST API:

- the newest commit on its default branch;
- the comparison from the commit the last digest ended at to it;
- for parameter files GitHub shows no patch for, the file at both ends.

When something changed, it writes a draft to `apps/web/src/modules/algorithm/data/<yyyy-mm>.json`, rewrites `data/index.ts`, and opens a pull request named *Algorithm digest for yyyy-mm: draft for review*. The draft holds:

| Field | What it is |
| --- | --- |
| `from`, `to`, `toDate` | The commit range, and the day of its last commit |
| `commits`, `files`, `filesCapped` | How many commits and files changed; GitHub lists 300 files at most, and `filesCapped` says when it stopped there |
| `areas` | Each area the range touched (ranking, filters, candidate sources, ads blending, content understanding, parameters, docs, other), with how many files and up to 10 of their names |
| `parameters`, `parameterCount` | Up to 50 names of parameters whose definition changed, and how many in all |
| `messages` | Up to 20 distinct commit messages, first line only |
| `summary` | Empty: yours to write |
| `status` | `draft`: the website shows nothing until it is `published` |

With no new commit, it writes nothing and opens nothing. A GitHub error fails the run with no file written, and GitHub emails the failure.

Everything in the draft comes from a repository Xomoni doesn't control. It is cut to 200 characters, with control and direction characters removed, and the website shows it as text, never as HTML.

## Before the first run

- **Allow GitHub Actions to open pull requests:** *Settings › Actions › General › Workflow permissions › Allow GitHub Actions to create and approve pull requests*. Without it, the workflow pushes the draft's branch, fails, and its error gives the link to open the pull request by hand.
- **The first digest needs a start.** With no digest in the folder yet, run the workflow by hand with `from` (and `to`, for a past month).

## Running it by hand

*Actions › Algorithm digest › Run workflow*, with:

- `month`: the digest's month, `yyyy-mm` (blank: this month). A month that has a digest already is refused.
- `from`: the full 40-character commit to compare from (blank: where the last digest ended).
- `to`: the full commit to compare to (blank: the newest).

Locally: `node tooling/algorithm-digest.mjs --month 2026-11 --from <commit> --to <commit>`. Set `GITHUB_TOKEN` for a higher rate limit; the script never prints it.

## Reviewing a draft

A pull request opened by GitHub Actions starts no checks. Pushing your summary starts them.

1. **Read the range** on GitHub: the pull request links `https://github.com/xai-org/x-algorithm/compare/<from>...<to>`.
2. **Check the areas.** Each area lists files of the range. If a path landed in the wrong area, or in `other`, fix `AREA_RULES` in `tooling/algorithm-digest-lib.mjs` in the same pull request.
3. **Write `summary`** in plain English, at most 2,000 characters. Separate paragraphs with a blank line (`\n\n` in the JSON).
4. **Set `status` to `"published"`**, push, and merge when every check is green ([quality gates](../QUALITY-GATES.md)).

A month with no change worth telling has no digest: close the pull request and delete its branch.

## What to say, and what not to

Say:

- **What changed in the structure:** a new filter, a stage removed, a candidate source added, a parameter renamed or added.
- **Where:** every claim names a file of the range, such as `home-mixer/params/config.rs`. If you can't point to a file, leave the claim out.
- **What it may mean for a person's reach,** only as far as the code shows it, in neutral words: "may", "is used when".

Don't say:

- **Weights or their effect.** The public code holds the structure, and defaults that aren't what X runs. The page already says the real weights are hidden; don't guess them.
- **Promises or advice** such as "post at 9 am" or "avoid links". The code doesn't show what X serves anyone.
- **Rumors or commentary** from outside the repository, however widely shared.
- **Anything about a person:** no account, no handle, no example post.

Keep the tone neutral: no "shadowban", no "secret", no "punish".

## Drafting with an AI model

Not now. Drafting the summary with a model needs a decision of its own: which model, a key in the repository's secrets, and how its text is reviewed ([ADR-0046](../adr/0046-a-public-digest-of-xs-open-ranking-code.md), 7). Until then, a person writes every word.
