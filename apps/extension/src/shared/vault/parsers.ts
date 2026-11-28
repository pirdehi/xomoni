// The core's parsers, registered in the order a file is offered to them (#425): X's archive, then X's analytics of
// days, then of posts, which takes every other CSV and refuses one that isn't X's. Importing this module registers them;
// a feature's parser registers itself the same way, after these.
import { ANALYTICS_DAYS_PARSER, ANALYTICS_POSTS_PARSER } from './analytics-parsers';
import { ARCHIVE_PARSER } from './archive-parser';
import type { VaultParser } from './importer';

/** The core's parsers, in the order a file is offered to them. */
export const CORE_PARSERS: readonly VaultParser[] = [ARCHIVE_PARSER, ANALYTICS_DAYS_PARSER, ANALYTICS_POSTS_PARSER];
