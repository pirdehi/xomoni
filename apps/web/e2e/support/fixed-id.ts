import path from 'node:path';

/**
 * The id Chrome gives the end-to-end test extension (`e2e/fixtures/fixed-id-extension`), derived from the `key` in its
 * manifest (#302). `playwright.config.ts` hands it to the site as `NEXT_PUBLIC_XOMONI_TEST_EXTENSION_ID`, so the site
 * looks for Xomoni there as it will at the stores' ids; `fixed-id.spec.ts` checks that Chrome gives this very id.
 */
export const TEST_EXTENSION_ID = 'lfkkdbhljalnifmdncjhifjonfpajeng';

/** The test extension's folder: a manifest with a fixed `key`, and a service worker that plays Xomoni. */
export const TEST_EXTENSION_DIR = path.join(__dirname, '..', 'fixtures', 'fixed-id-extension');
