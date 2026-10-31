# `packages/consent`: the informed-consent text

The text a person reads before Xomoni acts on an X account for the first time (#24, PLAYBOOK C7): X's rule against non-API automation, the risk that can't be removed, that deletions are permanent, to download the archive first, and what Xomoni never does. Apps import it as `@xomoni/consent`.

| Export | Used by |
| --- | --- |
| `CONSENT_SECTIONS`, `CONSENT_TITLE`, `CONSENT_INTRO`, `CONSENT_DECISION` | The extension's consent dialog and the xomoni.com `/risks` page. |
| `CONSENT_PHRASE` | What the person types to agree (`I UNDERSTAND`). |
| `CONSENT_VERSION` | Stored with each consent in the extension; raising it asks every X account again. |
| `consentMarkdown()` | The block in the root `README.md` between `<!-- consent:start -->` and `<!-- consent:end -->`. |

## Changing the text

1. Edit `src/index.ts`. Raise `CONSENT_VERSION` if the change matters to someone who already agreed.
2. Paste the output of `consentMarkdown()` into the README block. `npm test -w @xomoni/consent` fails until the README matches.

## Rules

- `packages-do-not-import-apps`: this package depends on nothing in `apps/`.
- Plain strings only, no markup, so every app renders it in its own way.
