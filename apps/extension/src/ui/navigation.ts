import type { Account } from '../shared/types';
import type { WorkerStatus } from './hooks';

/** The dashboard's pages, addressed by the URL hash (`#/cleanup`). */
export type PageId = 'overview' | 'cleanup' | 'library' | 'watch' | 'jobs' | 'activity' | 'settings';

/** Hashes of pages that were merged into another, so old links and bookmarks still land somewhere useful. */
export const MOVED_PAGES: Readonly<Record<string, PageId>> = { archive: 'library', inventory: 'library' };

/** Props every page receives from the app shell. */
export interface PageProps {
  /** The X account the dashboard is working with. */
  account: Account;
  /** Status of the X worker tab. */
  worker: WorkerStatus;
  /** Switches to another page. */
  navigate: (p: PageId) => void;
}
