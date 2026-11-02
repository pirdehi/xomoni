import { db, upsertAccount } from '../../src/shared/db';
import type { Account } from '../../src/shared/types';
import type { PageProps } from '../../src/ui/navigation';
import { vi } from 'vitest';

/** The X account the dashboard tests work with. */
export const ME = 'acct-me';

/** An account as the dashboard stores it, with counts from X. */
export function account(over: Partial<Account> = {}): Account {
  return {
    id: ME,
    handle: 'me',
    name: 'Me',
    avatar: '',
    postsCount: 1200,
    likesCount: 3400,
    followers: 10,
    following: 20,
    createdAt: Date.UTC(2015, 0, 1),
    profileAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  };
}

/** Empties every table, so each test starts from a fresh database. */
export async function resetDb() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

/** Stores the account and returns the props a page receives from the app shell. */
export async function pageProps(
  over: Partial<PageProps> = {},
): Promise<PageProps & { navigate: ReturnType<typeof vi.fn> }> {
  const acct = over.account ?? account();
  await upsertAccount(acct);
  const navigate = vi.fn();
  return { account: acct, worker: { open: false, info: null }, ...over, navigate };
}
