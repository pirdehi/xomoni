# ADR-0048: The AI exposure audit: X's AI policy windows as sourced data, read against the person's own posts on their computer

- Status: Proposed
- Date: 2026-11-28

## Context

X's rules about AI have changed more than once. Its privacy policy changed in late 2024 to let third parties train AI models on public posts unless the person turns that off, and its terms in force from 15 January 2026 count what people send to Grok, and what Grok answers, as content. xAI has rewritten its own terms around the same time. Each of these is a window in which a person's public posts, or their prompts, could be used for AI under X's own words. The plan's research reads them this way; each day is checked against the policy's text or an archived copy before it ships.

People don't know which of their posts were public in those windows. They know roughly when they joined, and some know when they turned the setting off, but nobody can line that up against ten years of posts by hand. Research on deanonymization and profiling also shows how much a model can guess from public posts alone: a city, an employer, health, religion, politics. Two ideas in Xomoni's list of features answer this: an inference mirror, and a watch on X's public terms (#518, #519).

Xomoni already holds what the audit needs, on the computer: the person's own posts and replies in the Library, with when each was made and whether it was removed (`items`, ADR-0004), and X's archive, which carries what X itself infers about them (`personalization.js`), read on the vault's importer ([ADR-0043](0043-the-vault-x-files-kept-on-the-computer.md)).

## Decision

1. **The policy windows are data with their sources.** `AI_POLICY_WINDOWS` in `shared/ai-policy.ts` lists each window: what it covers (public posts, or Grok prompts), when it began and ended (open while in force), and at least one source, each with an https address, its title and the day it was read, and `confirmed` (the policy's own text, or an archived copy of it) or `reported` (a reliable report, while the text can't be found). A window with no source doesn't ship, and a test fails on one. The list changes only by a pull request: nothing is fetched to build it.
2. **The person's own dates come from the person.** When they turned AI data sharing off on X, or *I never turned it off*, or *I don't know*, and when the account was private, are entered by the person and kept on the computer (`kv`), validated (between the account's creation and today, private spells that don't overlap), and carried in a move. Xomoni never reads X's settings and never turns anything on or off there ([ADR-0003](0003-no-credentials-no-evasion.md)); it links to X's own setting, which the person changes themselves. *I don't know* stays apart in every count rather than being guessed either way.
3. **Only the person's own posts and replies.** A post is counted in a window when it was public during it: from when it was made to when it was removed, if it was, less the private spells. Reposts and likes are other people's content and are left out. Nothing is inferred about anyone else.
4. **Words that say only what Xomoni can know.** Xomoni says a post "was public while X's terms allowed third-party AI training", never that X or anyone "used" or "trained on" it: nobody outside X can know that of one post. A test searches the feature's texts for such words, as Reach's do for its banned words ([ADR-0045](0045-reach-diagnosis-guesses-labelled-as-guesses.md)).
5. **No form about the person.** Xomoni never asks for the person's city, employer, health or beliefs. What X infers is shown from X's own file, as X wrote it, with a link to where the person can change it on X; an interest's name is drawn as text.
6. **Sensitive guesses only when asked.** When the inference mirror comes, what a model could guess about health, religion, politics or sexuality is computed only once the person turns it on, on the computer, and never about anyone else.
7. **On the computer, and kept only when saved.** The timeline is computed from the Library each time it is shown; the dates are kept, and a guess or a report is kept only when the person presses Save. Nothing of the audit goes to xomoni.com or any server ([ADR-0004](0004-x-data-stays-local.md)): no read of it is added to the website's ([ADR-0028](0028-xomoni-data-on-the-website-in-the-same-browser.md)). A card to share, if any, says that the person ran the audit and carries no post, count or guess about them.
8. **Acting goes through what exists.** The posts of a window can be sent to Review as findings of their own lens; only Cleanup, with its consent, preview, backup and typed DELETE, removes anything from X.

## Consequences

- The timeline (#519) and, later, the inference mirror are one feature, *AI exposure*, with one page. The watch on X's public terms is decided on its own with its server side, in R4.
- The windows need upkeep: when X or xAI changes its terms, a pull request adds or closes a window with its source. Until the watch on the terms exists, that is the maintainer's to notice.
- A count is an upper bound of what was exposed, never a claim of use, and the page says so in a section of its own (*What this does not say*).
- A person who removed posts before a window began sees them counted as removed before it, which is what Xomoni's own records show; posts known only from the archive and never seen live stay *unknown*.
- The dates add a `kv` entry and a line to the move file, and no Dexie version.

## Alternatives considered

- Reading the opt-out from X's settings page: it would be a request to X that the person didn't make, and the yellow modes that read X's pages on their own were removed (23 November 2026). The person enters it.
- Fetching the windows from a server: it would make the audit depend on xomoni.com and a list nobody reviewed. A list in the code, changed by pull request with its sources, can be read and checked by anyone.
- Saying which posts were "used for training": no one outside X can know, and saying so would be a guess presented as a fact.
- Counting likes and reposts: they are other people's posts.
