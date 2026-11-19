# `packages/bridge`: what xomoni.com and the extension say to each other

The messages xomoni.com and the Xomoni extension exchange inside one browser, through Chrome's `externally_connectable` ([ADR-0024](../../docs/adr/0024-connect-a-browser-with-one-click.md), [ADR-0025](../../docs/adr/0025-one-sign-in-for-the-website-and-the-extension.md)). Both apps import it as `@xomoni/bridge`, so the two sides can't drift. Every parser is strict: exact keys and shapes, anything else is refused.

| Export | Used by |
| --- | --- |
| `WEBSITE_ORIGIN` | The extension's sender check: only xomoni.com's top frame is heard. |
| `HELLO`, `SIGN_IN`, `SIGN_OUT`, `PAIR`, `JOB`, `OPEN` and their message types | The website builds them; the extension's service worker reads them with `parseWebsiteMessage`. `JOB` pauses, cancels or asks to resume a job (`JobAction`, never a start); `OPEN` opens one of Xomoni's pages (`XomoniPage`). Both name the device the page's account knows (ADR-0027). |
| `ActionAnswer`, `parseActionAnswer` | The website reads what the extension did with an action (`stopping`, `cancelled`, `asked`, `opened`) or why it refused. |
| `ExtensionState`, `parseExtensionState` | The extension's answer to a hello: its version, its xomoni.com connection (device id and masked account, never the token), since when it is signed out, and when the person last left xomoni.com there. |
| `parseSignInAnswer`, `parseSignOutAnswer` | The website reads the extension's answers. |
| `isExtensionId`, `EXTENSION_ID`, `PAIRING_CODE`, `NONCE`, `DEVICE_ID`, `JOB_ID` | Shapes both sides check. |

## Rules

- `packages-do-not-import-apps`: this package depends on nothing in `apps/`.
- No message carries X content ([ADR-0004](../../docs/adr/0004-x-data-stays-local.md)), and none can start or approve work on X: a resume only asks the person in Xomoni ([ADR-0027](../../docs/adr/0027-extension-actions-from-the-website.md)). A new message type needs the ADR updated.

## Tests

`tests/bridge.test.ts`: every message shape, the refusals (other types, extra fields, malformed codes, devices and nonces), and the answers, with 100% coverage.
