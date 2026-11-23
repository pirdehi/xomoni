# ADR-0046: A public digest of X's open ranking code, made from public code only

- Status: Accepted
- Date: 2026-11-23

## Context

X publishes the code of its recommendation system in a public repository, `xai-org/x-algorithm`, under the Apache-2.0 licence. Its changes are hard to follow:

- most commits touch configuration and pipeline code;
- the weights that matter most aren't published.

People who want to understand their reach ([ADR-0045](0045-reach-diagnosis-guesses-labelled-as-guesses.md)) ask what changed. A short monthly digest of those changes, in plain words on xomoni.com, would answer that (#430).

It is the one part of reach diagnosis that runs off the person's computer, so two things must hold:

- it carries no user data;
- the text it takes from a repository Xomoni doesn't control is shown safely.

## Decision

1. **Public code only.**
   - The digest is made only from `xai-org/x-algorithm`, read through GitHub's public REST API: the newest commit, and the comparison between the last digested commit and it.
   - No X data, no Xomoni user's data, no cookie and no analytics take part, in the workflow or on its pages.
2. **A monthly workflow drafts; it doesn't publish.**
   - `.github/workflows/algorithm-digest.yml` runs on the 20th of each month, and by hand.
   - It uses the workflow's own `GITHUB_TOKEN`, with `contents: write` and `pull-requests: write` only, and no other secret.
   - When something changed, it writes a draft (`status: "draft"`) to `apps/web/src/modules/algorithm/data/<yyyy-mm>.json`, and opens a pull request with it. A draft holds:
     - the commit range;
     - the areas the range touched (ranking, filters, candidate sources, ads blending, content understanding, parameters, docs);
     - the names of the parameters that changed.
   - With no new commit, it does nothing.
   - A GitHub error ends it with no file and a non-zero exit code.
3. **A maintainer reviews before anything is published.**
   - The maintainer writes the summary in plain English, and checks each claim against a file of the compared range.
   - The maintainer sets `status: "published"` and merges, through the same gate as every pull request ([ADR-0037](0037-one-written-gate-for-every-merge-and-release.md)).
   - The website shows published digests only. A draft's address answers 404.
4. **Outside text is untrusted.**
   - Commit messages and file names are data, never instructions.
   - They are cut to 200 characters, with control characters removed, and checked against a strict schema.
   - They are shown as text, never as HTML.
   - The pages are static, under the site's Content-Security-Policy, unchanged ([ADR-0014](0014-security-headers-and-a-static-csp.md)).
5. **It says what it can't tell.**
   - Each digest says it shows the structure only, because the real weights are not in the public code.
   - It links the compared range on GitHub.
6. **The extension only links.**
   - Reach links to `https://xomoni.com/algorithm`, opened in a new tab.
   - The extension fetches nothing for the digest, and its CSP doesn't change.
7. **Written by a person.** Drafting the summary with an AI model would need a decision of its own: the model, a key in the repository's secrets, and how its text is reviewed. Until then, the maintainer writes it.

Built in [#430](https://github.com/pirdehi/xomoni/issues/430).

## Consequences

- **A new workflow,** under `CODEOWNERS` and the gate. When it lands, `tooling/workflows.test.mjs` checks its permissions, and `docs/ARCHITECTURE.md` lists it with the others.
- **The website gets a module, `algorithm`,** with no database table: the digests live in the repository and are rendered as static pages.
- **The maintainer spends some time each month.** A month with no change has no digest.
- **Nothing about any person ever reaches the digest,** so it may be shown to anyone, signed in or not.
- **It depends on X keeping the repository public,** and its layout recognizable. When the paths move, the area rules change in the same pull request as the next digest.

## Alternatives considered

- **Summarize commentary about X's algorithm.** It can't be checked against the code, and much of it is rumor.
- **Publish drafts automatically.** An unreviewed summary of code we don't control could say something false under Xomoni's name.
- **Draft with an AI model now.** Faster, but it needs a key in the repository and a review rule. That is left to its own decision.
- **Show the digest inside the extension.** It would need a network request from the extension, or a release every month. A link keeps the extension unchanged.
