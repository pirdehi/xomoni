import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_JSON, GRACE_ID, OVERVIEW_JSON, PLAN_JSON, USER_JSON, USER_ROW_JSON } from '@test/fakes/admin-console';
import { AdminError } from '../domain/problems';
import { createSupabaseConsoleStore, problemOfCode } from './supabase-console-store';

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** A scripted client: `rpc` answers from `rpcs` by function name; `from()` records its chain and resolves to `table`. */
function fakeClient(rpcs: Record<string, Result> = {}, table: Result = { data: null, error: null }) {
  const chain: [string, unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      chain.push([method, args]);
      return builder;
    };
  }
  builder.maybeSingle = () => {
    chain.push(['maybeSingle', []]);
    return Promise.resolve(table);
  };
  const from = vi.fn((name: string) => {
    chain.push(['from', [name]]);
    return builder;
  });
  const rpc = vi.fn((fn: string) => Promise.resolve(rpcs[fn] ?? { data: null, error: null }));
  return { client: { rpc, from } as unknown as SupabaseClient<Database>, rpc, chain };
}

const ok = (data: unknown): Result => ({ data, error: null });

describe('createSupabaseConsoleStore (#516)', () => {
  it('asks the database whether the signed-in person is a super-admin', async () => {
    const { client, rpc } = fakeClient({ is_superadmin: ok(true) });
    expect(await createSupabaseConsoleStore(client).isSuperadmin()).toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_superadmin');
  });

  it('reads the overview through admin_overview()', async () => {
    const { client, rpc } = fakeClient({ admin_overview: ok(OVERVIEW_JSON) });
    expect((await createSupabaseConsoleStore(client).overview()).users.total).toBe(120);
    expect(rpc).toHaveBeenCalledWith('admin_overview');
  });

  it('reads a page of accounts with the search, sort, direction and page it was given', async () => {
    const { client, rpc } = fakeClient({ admin_users: ok({ total: 1, rows: [USER_ROW_JSON] }) });
    const page = await createSupabaseConsoleStore(client).users(
      { search: 'grace', sort: 'email', descending: false, page: 2 },
      25,
    );
    expect(page.rows[0]?.email).toBe('grace@example.com');
    expect(rpc).toHaveBeenCalledWith('admin_users', {
      search: 'grace',
      sort: 'email',
      descending: false,
      page_size: 25,
      page_index: 2,
    });
  });

  it('reads one account, null when there is none or the id can’t be one', async () => {
    const { client, rpc } = fakeClient({ admin_user: ok(USER_JSON) });
    expect((await createSupabaseConsoleStore(client).user(GRACE_ID))?.email).toBe('grace@example.com');
    expect(rpc).toHaveBeenCalledWith('admin_user', { target: GRACE_ID });

    expect(await createSupabaseConsoleStore(fakeClient({ admin_user: ok(null) }).client).user(GRACE_ID)).toBeNull();
    const badId = fakeClient({
      admin_user: { data: null, error: { message: 'invalid input syntax for type uuid', code: '22P02' } },
    });
    expect(await createSupabaseConsoleStore(badId.client).user('nope')).toBeNull();
  });

  it('reads the audit log through admin_audit_log() with its page size', async () => {
    const { client, rpc } = fakeClient({ admin_audit_log: ok(AUDIT_JSON) });
    expect(await createSupabaseConsoleStore(client).auditLog(50)).toHaveLength(3);
    expect(rpc).toHaveBeenCalledWith('admin_audit_log', { page_size: 50 });
  });

  it('reads the published plan from product_plan, or null before the first', async () => {
    const { client, chain } = fakeClient({}, ok({ data: PLAN_JSON, updated_at: '2026-11-28T06:05:00Z' }));
    const published = await createSupabaseConsoleStore(client).plan();
    expect(published?.updatedAt).toBe('2026-11-28T06:05:00Z');
    expect(published?.plan.release.latest).toBe('0.6.1');
    expect(chain).toEqual([
      ['from', ['product_plan']],
      ['select', ['data, updated_at']],
      ['order', ['updated_at', { ascending: false }]],
      ['limit', [1]],
      ['maybeSingle', []],
    ]);
    expect(await createSupabaseConsoleStore(fakeClient().client).plan()).toBeNull();
  });

  it('acts on an account only through the admin_* functions, which write the audit log', async () => {
    const { client, rpc } = fakeClient({ admin_sign_out_user: ok(4) });
    const store = createSupabaseConsoleStore(client);
    expect(await store.signOutUser(GRACE_ID)).toBe(4);
    await store.setBanned(GRACE_ID, true);
    await store.setBanned(GRACE_ID, false);
    await store.deleteUser(GRACE_ID);
    expect(rpc.mock.calls).toEqual([
      ['admin_sign_out_user', { target: GRACE_ID }],
      ['admin_set_banned', { target: GRACE_ID, banned: true }],
      ['admin_set_banned', { target: GRACE_ID, banned: false }],
      ['admin_delete_user', { target: GRACE_ID }],
    ]);
  });

  it('turns the database’s refusals into the console’s problems', async () => {
    const refused = { data: null, error: { message: 'Not allowed.', code: '42501' } };
    const gone = { data: null, error: { message: 'No such account.', code: 'P0002' } };
    const store = createSupabaseConsoleStore(
      fakeClient({
        admin_delete_user: refused,
        admin_set_banned: gone,
        admin_overview: { data: null, error: { message: 'down' } },
      }).client,
    );
    await expect(store.deleteUser(GRACE_ID)).rejects.toMatchObject({
      problem: 'forbidden',
      message: 'admin_delete_user: Not allowed.',
    });
    await expect(store.setBanned(GRACE_ID, true)).rejects.toMatchObject({ problem: 'not-found' });
    await expect(store.overview()).rejects.toBeInstanceOf(AdminError);
    await expect(store.overview()).rejects.toMatchObject({ problem: 'failed' });
  });

  it('fails every other call the database refuses, naming the function', async () => {
    const error = { data: null, error: { message: 'boom', code: '42501' } };
    const store = createSupabaseConsoleStore(
      fakeClient(
        {
          is_superadmin: error,
          admin_users: error,
          admin_user: error,
          admin_audit_log: error,
          admin_sign_out_user: error,
        },
        error,
      ).client,
    );
    await expect(store.isSuperadmin()).rejects.toThrow('is_superadmin: boom');
    await expect(store.users({ search: '', sort: 'created_at', descending: true, page: 0 }, 25)).rejects.toThrow(
      'admin_users',
    );
    await expect(store.user(GRACE_ID)).rejects.toThrow('admin_user');
    await expect(store.auditLog(50)).rejects.toThrow('admin_audit_log');
    await expect(store.signOutUser(GRACE_ID)).rejects.toThrow('admin_sign_out_user');
    await expect(store.plan()).rejects.toThrow('product_plan');
  });
});

describe('problemOfCode', () => {
  it('maps insufficient privilege, no data found and anything else', () => {
    expect(problemOfCode('42501')).toBe('forbidden');
    expect(problemOfCode('P0002')).toBe('not-found');
    expect(problemOfCode('22023')).toBe('failed');
    expect(problemOfCode(undefined)).toBe('failed');
  });
});
