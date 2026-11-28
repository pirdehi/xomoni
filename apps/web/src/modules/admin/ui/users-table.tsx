'use client';

import { Button, SearchBox, makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { ArrowDown16Regular, ArrowSort16Regular, ArrowUp16Regular } from '@fluentui/react-icons';
import {
  createColumnHelper,
  createTable,
  flexRender,
  getCoreRowModel,
  type Table,
  type TableOptions,
  type TableState,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition, type MouseEvent } from 'react';
import { formatDate, formatNumber, formatWhen } from '../domain/format';
import { tierLabel } from '../domain/overview';
import { CONSOLE_PATHS, userPath } from '../domain/routes';
import {
  MAX_SEARCH_LENGTH,
  USER_SORTS,
  descendingByDefault,
  pageCount,
  providerLabel,
  userBadges,
  userQueryString,
  type UserPage,
  type UserQuery,
  type UserRow,
  type UserSort,
} from '../domain/users';
import { ConsolePage, LoadFailed, UserBadges } from './page-frame';

/** How long typing pauses before the list searches. */
export const SEARCH_DELAY_MS = 300;

const useStyles = makeStyles({
  bar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  search: { width: '100%', maxWidth: '360px' },
  scroller: {
    overflowX: 'auto',
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    ...typographyStyles.body1,
    whiteSpace: 'nowrap',
    transitionProperty: 'opacity',
    transitionDuration: tokens.durationFaster,
  },
  busy: { opacity: 0.6 },
  th: {
    textAlign: 'start',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
  },
  td: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  number: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  row: { cursor: 'pointer', ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover } },
  sort: { fontWeight: tokens.fontWeightSemibold, minWidth: 0, paddingInline: 0 },
  email: {
    color: tokens.colorBrandForegroundLink,
    fontWeight: tokens.fontWeightSemibold,
    ':hover': { textDecorationLine: 'underline' },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  empty: { margin: 0, padding: tokens.spacingHorizontalXL, color: tokens.colorNeutralForeground3 },
  pager: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  pagerText: { color: tokens.colorNeutralForeground2, fontVariantNumeric: 'tabular-nums' },
  hidden: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
});

const column = createColumnHelper<UserRow>();

const isSortable = (id: string): id is UserSort => USER_SORTS.some((sort) => sort === id);

/** The users list's columns, in order; the sortable ones carry the sort key `admin_users()` takes as their id. */
const COLUMNS = [
  column.accessor('email', {
    id: 'email',
    header: 'Email',
    cell: (c) => <EmailCell row={c.row.original} />,
  }),
  column.accessor('createdAt', { id: 'created_at', header: 'Joined', cell: (c) => formatDate(c.getValue()) }),
  column.accessor('lastSignInAt', {
    id: 'last_sign_in_at',
    header: 'Last sign-in',
    cell: (c) => formatWhen(c.getValue(), 'Never'),
  }),
  column.accessor('providers', {
    id: 'providers',
    header: 'Sign-in methods',
    cell: (c) => c.getValue().map(providerLabel).join(', ') || '—',
  }),
  column.accessor('mfa', { id: 'mfa', header: '2FA', cell: (c) => (c.getValue() ? 'On' : 'Off') }),
  column.accessor('devices', { id: 'devices', header: 'Browsers', cell: (c) => formatNumber(c.getValue()) }),
  column.accessor('lastSeenAt', {
    id: 'last_seen_at',
    header: 'Last seen',
    cell: (c) => formatWhen(c.getValue(), 'Never'),
  }),
  column.accessor('jobs', { id: 'jobs', header: 'Jobs', cell: (c) => formatNumber(c.getValue()) }),
  column.accessor('tier', { id: 'tier', header: 'Plan', cell: (c) => tierLabel(c.getValue()) }),
  column.display({ id: 'status', header: 'Status', cell: (c) => <UserBadges badges={userBadges(c.row.original)} /> }),
];

const NUMERIC = new Set(['devices', 'jobs']);

/**
 * A TanStack table whose whole state comes from the caller, built afresh on each render. The users list keeps no table
 * state of its own (the address holds the search, sort and page), so it doesn't need `useReactTable`, whose one table
 * object changes under React's feet and which the React Compiler can't memoize safely.
 */
export function controlledTable<T>(options: TableOptions<T> & { state: Partial<TableState> }): Table<T> {
  const table = createTable<T>({ ...options, onStateChange: () => undefined, renderFallbackValue: null });
  table.setOptions((previous) => ({ ...previous, state: { ...table.initialState, ...options.state } }));
  return table;
}

function EmailCell({ row }: { row: UserRow }) {
  const s = useStyles();
  return (
    <Link href={userPath(row.id)} className={s.email}>
      {row.email || row.id}
    </Link>
  );
}

/**
 * The console's users list (#516), on TanStack Table: every account, searched, sorted and paged on the server through
 * the address (`?q=&sort=&desc=&page=`), so a list can be shared and the back button works. Typing searches after a
 * short pause; a column header sorts by it (again: the other way); a row opens the account. `page` is null when the
 * database couldn't give it.
 */
export function UsersTable({ query, page, pageSize }: { query: UserQuery; page: UserPage | null; pageSize: number }) {
  const s = useStyles();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.search);
  // When the address changes its search from elsewhere (the back button), the box follows it, so the pause below
  // doesn't put the old search back. What the person is typing stays as typed.
  const [shown, setShown] = useState(query.search);
  if (shown !== query.search) {
    setShown(query.search);
    if (search.trim().slice(0, MAX_SEARCH_LENGTH) !== query.search) setSearch(query.search);
  }

  const go = useCallback(
    (next: UserQuery) => startTransition(() => router.replace(`${CONSOLE_PATHS.users}${userQueryString(next)}`)),
    [router],
  );

  useEffect(() => {
    const wanted = search.trim().slice(0, MAX_SEARCH_LENGTH);
    if (wanted === query.search) return;
    const timer = setTimeout(() => go({ ...query, search: wanted, page: 0 }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, query, go]);

  const total = page?.total ?? 0;
  const pages = pageCount(total, pageSize);
  const table = controlledTable({
    data: page ? [...page.rows] : [],
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    pageCount: pages,
    state: {
      sorting: [{ id: query.sort, desc: query.descending }],
      pagination: { pageIndex: query.page, pageSize },
    },
  });

  function sortBy(id: string) {
    if (!isSortable(id)) return;
    const descending = id === query.sort ? !query.descending : descendingByDefault(id);
    go({ ...query, sort: id, descending, page: 0 });
  }

  function openRow(event: MouseEvent<HTMLTableRowElement>, row: UserRow) {
    // The email is a link of its own; anything else in the row opens the account too.
    if (event.target instanceof Element && event.target.closest('a, button')) return;
    router.push(userPath(row.id));
  }

  const rows = table.getRowModel().rows;

  return (
    <ConsolePage
      title="Users"
      description={page ? `${formatNumber(total)} ${total === 1 ? 'account' : 'accounts'}` : undefined}
    >
      <div className={s.bar}>
        <SearchBox
          className={s.search}
          aria-label="Search by email"
          placeholder="Search by email"
          value={search}
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(_, data) => setSearch(data.value)}
        />
      </div>
      {!page ? (
        <LoadFailed what="the accounts" />
      ) : rows.length === 0 ? (
        <p className={s.empty} role="status">
          {query.search ? `No account matches “${query.search}”.` : 'No accounts yet.'}
        </p>
      ) : (
        <div className={s.scroller} role="region" aria-label="Accounts" tabIndex={0}>
          <table className={mergeClasses(s.table, pending && s.busy)} aria-busy={pending}>
            <caption className={s.hidden}>Accounts, sorted by {query.sort.replace(/_/g, ' ')}</caption>
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const label = flexRender(header.column.columnDef.header, header.getContext());
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        className={mergeClasses(s.th, NUMERIC.has(header.id) && s.number)}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                      >
                        {isSortable(header.id) ? (
                          <Button
                            appearance="transparent"
                            size="small"
                            className={s.sort}
                            icon={
                              sorted === 'asc' ? (
                                <ArrowUp16Regular />
                              ) : sorted === 'desc' ? (
                                <ArrowDown16Regular />
                              ) : (
                                <ArrowSort16Regular />
                              )
                            }
                            iconPosition="after"
                            onClick={() => sortBy(header.id)}
                          >
                            {label}
                          </Button>
                        ) : (
                          label
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={s.row} onClick={(event) => openRow(event, row.original)}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={mergeClasses(s.td, NUMERIC.has(cell.column.id) && s.number)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page && total > 0 && (
        <nav className={s.pager} aria-label="Pages">
          <Button
            disabled={!table.getCanPreviousPage() || pending}
            onClick={() => go({ ...query, page: query.page - 1 })}
          >
            Previous
          </Button>
          <span className={s.pagerText}>{`Page ${formatNumber(query.page + 1)} of ${formatNumber(pages)}`}</span>
          <Button disabled={!table.getCanNextPage() || pending} onClick={() => go({ ...query, page: query.page + 1 })}>
            Next
          </Button>
        </nav>
      )}
    </ConsolePage>
  );
}
