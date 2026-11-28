# ADR-0049: The on-device archive scanner, a new extension area that never touches X

- Status: Proposed
- Date: 2026-11-25

## Context

R2 and later releases read a person's old posts for what could hurt them today:

- the context lens for old posts, with visa mode and legal hold (P3);
- the AI exposure timeline (P6);
- place and personal details in posts and photos (P4).

Each needs the same machinery:

- read X's archive and the Library, which are already on the computer ([ADR-0022](0022-get-the-x-archive-without-leaving-xomoni.md), [ADR-0043](0043-the-vault-x-files-kept-on-the-computer.md));
- run rules and, later, a small model over every post;
- say why each post was flagged;
- let the person decide, post by post.

Built three times, the risks would be built three times too:

- a scan that asks X for something;
- a finding without a reason;
- a decision that deletes without the person's typed DELETE.

X's rules prohibit "non-API automation, such as scripting the X website" ([PLAYBOOK C7](../PLAYBOOK.md)). Reading files already on the computer does nothing on X. Deleting does, and Xomoni already deletes only through Cleanup: informed consent (`I UNDERSTAND`), a preview, a backup and a typed DELETE, at a fifth of X's limits ([ADR-0012](0012-one-fifth-of-every-x-limit.md)) and under the risk ladder ([ADR-0013](0013-risk-ladder.md)).

A scan of 100,000 posts takes long enough to freeze a page, so it runs in a worker. A model (ADR-0050) may need a download (ADR-0051), the one network request this area could ever make.

## Decision

1. **A new area, `apps/extension/src/scanner/`.** It holds the shared scanner every lens uses:
   - text normalization;
   - rules and detectors;
   - the scan worker and its controller;
   - the model runners behind ports.

   Each lens adds its own lexicons and detectors to it, never a second scanner.
2. **It never touches X.** Rule `ext-scanner-is-headless` keeps this checkable:
   - `scanner/` imports only `scanner/` and `shared/`;
   - it never imports `engine/`, `content/`, `inject/`, `ui/`, `cloud/` or `background/`;
   - it sends no message to a content script, and opens, reads or steers no X tab;
   - the only `fetch` in it is `scanner/models/store.ts`, which downloads a model pack the person asked for (ADR-0051). An ESLint rule bans `fetch` and `chrome` everywhere else in the core.
3. **Its core depends on ports.** `scanner/ports.ts` defines `ModelRunner`, `ScanStore` and `Clock`, and `scanner/platform.ts` wires the adapters. Rule `ext-scanner-core-uses-ports` keeps the core off the model adapters (`scanner/models/{chrome-ai,transformers,webllm,store}.ts`), as `engine/` is kept off Chrome ([#11](https://github.com/pirdehi/xomoni/issues/11)).
4. **A scan runs in its own worker.**
   - The worker reads items page by page (500 at a time) and writes what it found.
   - A Web Lock, `xomoni-scanner`, allows one scan per profile.
   - The run keeps a cursor, so it resumes after a reload.
   - The worker answers only typed, checked messages.
5. **A finding is a proposal, never an action.** Its life:
   1. a detector proposes it, with a reason code, the span of text that shows it, a severity and the detector's id;
   2. the person decides: *Keep*, *Dismiss*, *I'll edit it myself* or *Send to Cleanup*;
   3. *Send to Cleanup* writes a plan that opens Cleanup on those posts.

   **Only Cleanup's own consent, preview, backup and typed DELETE build a job.** The scanner never creates a job, and nothing deletes from the review queue. Without a reason, there is no finding: a detector that can't say why doesn't report.
6. **Its data stays on the computer** ([ADR-0004](0004-x-data-stays-local.md)), in four new tables of the extension's database:

   | Table | What it holds | Wiped and forgotten | In a backup | In the move file |
   | --- | --- | --- | --- | --- |
   | `archiveExtras` | the archive's places, media, mentions, links and language per post | Yes | Never | Yes: rebuilding it needs the archive again |
   | `findings` | what a scan proposed, with its reasons | Yes | Never | No: a new scan rebuilds it |
   | `reviews` | the person's decision on each finding | Yes | Never | Yes: decisions are the person's work |
   | `scanRuns` | each scan's state and cursor | Yes | Never | No: a new scan rebuilds it |

   - *Delete local data* empties all four, and `forgetAccount` deletes one account's rows.
   - The move file carries its tables through the vault's registry ([ADR-0032](0032-move-data-between-xomoni-versions.md) as amended in #467), without raising `MOVE_VERSION`. A file that holds `findings` or `scanRuns` is refused as holding an unknown table.
   - No finding, decision, model or text goes to xomoni.com, and the database gains no table or column for them.
7. **The plan to Cleanup is local.** The review queue's plan (`ReviewPlan`) waits in `kv` for the Cleanup page, beside the plan the website can send (#235). The website still cannot start, resume or approve work on X ([ADR-0006](0006-website-is-view-only.md), [ADR-0027](0027-extension-actions-from-the-website.md)): this ADR doesn't change them.

## Consequences

- Every lens (P3, P4, P6) is a set of lexicons, detectors and words on one scanner. A fix to normalization or to the worker reaches all of them.
- `npm run arch` and ESLint check the boundary on every pull request, so a scan that asks X for anything fails the build, not a review.
- The Dexie version for the four tables follows the vault's (8) and Reach's (9): version 10 (CS.1.6). Like them, it waits for the merge hold on Dexie and the move file.
- A scan is as safe as reading a file. The risk stays in deleting, where it always was: in Cleanup, behind its consent, and named in the consent's words.
- Follow-up work:
  - ADR-0050 decides the model runners;
  - ADR-0051 decides how model packs are downloaded;
  - ADR-0052 decides what the scanner may do with other people's data in the archive;
  - CS.1.5 adds the area with its rules, CS.1.6 the tables, and CS.1.7 the archive's extra fields.

## Alternatives considered

- **Each project its own scanner, in `shared/`.** No boundary to check, and three workers, three rules engines and three review queues.
- **Scanning in the dashboard page itself.** Simpler, but 100,000 posts freeze the page, and nothing would stop the page's code from reaching `engine/`.
- **Scanning on xomoni.com.** Posts would leave the computer (ADR-0004). Rejected outright.
- **Letting the review queue delete directly.** Faster for the person, but it would bypass Cleanup's consent, preview, backup and typed DELETE, which are the only gate to X.
