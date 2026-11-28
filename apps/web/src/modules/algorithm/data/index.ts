// Written by `node tooling/algorithm-digest.mjs` from the digest files beside it (ADR-0046): don’t edit it by hand.
// Each file is untrusted until the module’s `parseDigest` has checked it.
/** Every digest file in this folder, oldest month first, as read from disk and not yet checked. */
export const DIGEST_FILES: readonly unknown[] = [];
