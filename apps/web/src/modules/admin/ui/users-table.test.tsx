// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { GRACE_ID, USER_ROW_JSON } from '@test/fakes/admin-console';
import { resetNavigation, router } from '@test/fakes/navigation';
import { getCoreRowModel } from '@tanstack/react-table';
import { DEFAULT_USER_QUERY, parseUserPage, type UserQuery } from '../domain/users';
import { SEARCH_DELAY_MS, UsersTable, controlledTable } from './users-table';

const ADMIN_ROW = {
  ...USER_ROW_JSON,
  id: 'a1',
  email: 'maintainer@example.com',
  superadmin: true,
  mfa: true,
  providers: ['email'],
  tier: null,
  last_sign_in_at: null,
  last_seen_at: null,
  devices: 0,
};
const BANNED_ROW = { ...USER_ROW_JSON, id: 'b1', email: 'mallory@example.com', banned: true, confirmed: false };
const page = parseUserPage({ total: 53, rows: [USER_ROW_JSON, ADMIN_ROW, BANNED_ROW] });

function table(query: UserQuery = DEFAULT_USER_QUERY, rows = page) {
  return render(<UsersTable query={query} page={rows} pageSize={25} />);
}

const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) });

describe('UsersTable (#516)', () => {
  beforeEach(() => resetNavigation());

  it('shows each account’s columns, its email linking to its page', () => {
    table();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Email',
      'Joined',
      'Last sign-in',
      'Sign-in methods',
      '2FA',
      'Browsers',
      'Last seen',
      'Jobs',
      'Plan',
      'Status',
    ]);
    const grace = screen.getByRole('row', { name: /grace@example.com/ });
    expect(
      within(grace)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([
      'grace@example.com',
      '1 Nov 2026',
      '27 Nov 2026, 08:00 UTC',
      'Password, Google',
      'Off',
      '2',
      '28 Nov 2026, 07:00 UTC',
      '5',
      'Plus',
      '',
    ]);
    expect(within(grace).getByRole('link', { name: 'grace@example.com' })).toHaveAttribute(
      'href',
      `/product/users/${GRACE_ID}`,
    );
    expect(screen.getByText('53 accounts')).toBeInTheDocument();
  });

  it('labels a super-admin, a suspension and an unconfirmed email, and says never for no sign-in yet', () => {
    table();
    const admin = screen.getByRole('row', { name: /maintainer@example.com/ });
    expect(admin).toHaveTextContent('Super-admin');
    expect(admin).toHaveTextContent('Never');
    expect(admin).toHaveTextContent('Free');
    const mallory = screen.getByRole('row', { name: /mallory@example.com/ });
    expect(mallory).toHaveTextContent('Suspended');
    expect(mallory).toHaveTextContent('Unconfirmed');
  });

  it('opens an account from anywhere in its row', async () => {
    table();
    await userEvent.click(within(screen.getByRole('row', { name: /grace@example.com/ })).getByText('Password, Google'));
    expect(router.push).toHaveBeenCalledWith(`/product/users/${GRACE_ID}`);
  });

  it('marks the sort, and sorts by a column on its header, the other way on the same column', async () => {
    table();
    expect(header('Joined')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Email')).not.toHaveAttribute('aria-sort');

    await userEvent.click(within(header('Email')).getByRole('button'));
    expect(router.replace).toHaveBeenLastCalledWith('/product/users?sort=email');
    await userEvent.click(within(header('Joined')).getByRole('button'));
    expect(router.replace).toHaveBeenLastCalledWith('/product/users?desc=0');
    await userEvent.click(within(header('Browsers')).getByRole('button'));
    expect(router.replace).toHaveBeenLastCalledWith('/product/users?sort=devices');
  });

  it('only sorts by the columns the database sorts by', () => {
    table();
    for (const name of ['Sign-in methods', '2FA', 'Jobs', 'Plan', 'Status']) {
      expect(within(header(name)).queryByRole('button')).not.toBeInTheDocument();
    }
  });

  it('keeps the search when sorting, and goes back to the first page', async () => {
    table({ search: 'grace', sort: 'created_at', descending: true, page: 2 });
    await userEvent.click(within(header('Email')).getByRole('button'));
    expect(router.replace).toHaveBeenLastCalledWith('/product/users?q=grace&sort=email');
  });

  it('searches once typing pauses, from the first page', async () => {
    table({ ...DEFAULT_USER_QUERY, page: 1 });

    const started = Date.now();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search by email' }), ' grace ');
    // Each key starts the pause again, so nothing was searched while typing.
    if (Date.now() - started < SEARCH_DELAY_MS) expect(router.replace).not.toHaveBeenCalled();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/product/users?q=grace'));
    expect(router.replace).toHaveBeenCalledOnce();
  });

  it('follows a search the address changed from elsewhere, such as the back button, without searching again', async () => {
    const { rerender } = table({ ...DEFAULT_USER_QUERY, search: 'grace' });
    const box = screen.getByRole('searchbox', { name: 'Search by email' });
    expect(box).toHaveValue('grace');
    rerender(<UsersTable query={DEFAULT_USER_QUERY} page={page} pageSize={25} />);
    expect(box).toHaveValue('');
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 50));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('pages forwards and back, and stops at either end', async () => {
    const { unmount } = table();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.replace).toHaveBeenLastCalledWith('/product/users?page=2');
    unmount();

    table({ ...DEFAULT_USER_QUERY, page: 2 });
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(router.replace).toHaveBeenLastCalledWith('/product/users?page=2');
  });

  it('says when no account matches, or there are none, or the list couldn’t load', () => {
    const empty = parseUserPage({ total: 0, rows: [] });
    const { rerender } = table({ ...DEFAULT_USER_QUERY, search: 'nobody' }, empty);
    expect(screen.getByRole('status')).toHaveTextContent('No account matches “nobody”.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    rerender(<UsersTable query={DEFAULT_USER_QUERY} page={empty} pageSize={25} />);
    expect(screen.getByRole('status')).toHaveTextContent('No accounts yet.');
    rerender(<UsersTable query={DEFAULT_USER_QUERY} page={null} pageSize={25} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load the accounts.');
  });
});

describe('controlledTable', () => {
  it('takes its whole state from the caller', () => {
    const t = controlledTable({
      data: [{ n: 1 }, { n: 2 }],
      columns: [{ accessorKey: 'n', header: 'N' }],
      getCoreRowModel: getCoreRowModel(),
      manualPagination: true,
      pageCount: 4,
      state: { pagination: { pageIndex: 3, pageSize: 2 }, sorting: [{ id: 'n', desc: true }] },
    });
    expect(t.getState().pagination).toEqual({ pageIndex: 3, pageSize: 2 });
    expect(t.getState().sorting).toEqual([{ id: 'n', desc: true }]);
    expect(t.getState().columnVisibility).toEqual({});
    expect(t.getCanNextPage()).toBe(false);
    expect(t.getCanPreviousPage()).toBe(true);
  });
});
