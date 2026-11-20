// Sends a GitHub release's zip to a browser store, or submits the store's draft for review (docs/RELEASING.md#stores).
// .github/workflows/store.yml runs it with the store's secrets in the environment. The calls live in
// tooling/store-api.mjs, tested by tooling/store-api.test.mjs.
//
//   node tooling/store.mjs upload chrome|edge vX.Y.Z [--dir release]       release/xomoni-extension-X.Y.Z.zip becomes
//                                                                         the store's draft; nothing goes to review
//   node tooling/store.mjs publish chrome|edge vX.Y.Z [--percentage N]     the draft goes to review, then live
import { StoreError, parseStoreArgs, runStore } from './store-api.mjs';

const inActions = process.env.GITHUB_ACTIONS === 'true';

try {
  const line = await runStore(parseStoreArgs(process.argv.slice(2)), process.env, {
    log: (message) => console.log(message),
    // The access token is made here, not stored as a secret, so GitHub only hides it in the log when told to.
    mask: (value) => {
      if (inActions) console.log(`::add-mask::${value}`);
    },
  });
  console.log(line);
} catch (error) {
  if (!(error instanceof StoreError)) throw error;
  console.error(inActions ? `::error::${error.message}` : error.message);
  process.exit(1);
}
