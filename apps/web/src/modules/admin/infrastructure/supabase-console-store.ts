import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import type { ConsoleStore } from '../application/ports';
import { parseAuditLog } from '../domain/audit';
import { parseOverview } from '../domain/overview';
import { parsePlan } from '../domain/plan';
import { AdminError, type AdminProblem } from '../domain/problems';
import { parseUserDetail, parseUserPage } from '../domain/users';

type Client = SupabaseClient<Database>;

/**
 * The problem behind a Postgres error code: `42501` (insufficient privilege) is the database refusing a caller who
 * isn't a super-admin, a session below aal2 for an account with an authenticator app, or an action on oneself or
 * another super-admin; `P0002` (no data found) is an account that is gone. Anything else failed.
 */
export function problemOfCode(code: string | undefined): AdminProblem {
  if (code === '42501') return 'forbidden';
  if (code === 'P0002') return 'not-found';
  return 'failed';
}

function fail(what: string, error: { message: string; code?: string }): never {
  throw new AdminError(problemOfCode(error.code), `${what}: ${error.message}`);
}

/**
 * The console's store on Supabase (#516), as the signed-in person: every read and change goes through the database's
 * `admin_*` functions, which check for a super-admin themselves and write the audit log, and the published plan is read
 * from `public.product_plan`, which only a super-admin may read.
 */
export function createSupabaseConsoleStore(supabase: Client): ConsoleStore {
  return {
    async isSuperadmin() {
      const { data, error } = await supabase.rpc('is_superadmin');
      if (error) fail('is_superadmin', error);
      return data;
    },
    async overview() {
      const { data, error } = await supabase.rpc('admin_overview');
      if (error) fail('admin_overview', error);
      return parseOverview(data);
    },
    async users(query, pageSize) {
      const { data, error } = await supabase.rpc('admin_users', {
        search: query.search,
        sort: query.sort,
        descending: query.descending,
        page_size: pageSize,
        page_index: query.page,
      });
      if (error) fail('admin_users', error);
      return parseUserPage(data);
    },
    async user(id) {
      const { data, error } = await supabase.rpc('admin_user', { target: id });
      if (error) {
        // An id that isn't a uuid can't name an account.
        if (error.code === '22P02') return null;
        fail('admin_user', error);
      }
      return parseUserDetail(data);
    },
    async auditLog(limit) {
      const { data, error } = await supabase.rpc('admin_audit_log', { page_size: limit });
      if (error) fail('admin_audit_log', error);
      return parseAuditLog(data);
    },
    async plan() {
      const { data, error } = await supabase
        .from('product_plan')
        .select('data, updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail('product_plan', error);
      return data ? { plan: parsePlan(data.data), updatedAt: data.updated_at } : null;
    },
    async signOutUser(id) {
      const { data, error } = await supabase.rpc('admin_sign_out_user', { target: id });
      if (error) fail('admin_sign_out_user', error);
      return data;
    },
    async setBanned(id, banned) {
      const { error } = await supabase.rpc('admin_set_banned', { target: id, banned });
      if (error) fail('admin_set_banned', error);
    },
    async deleteUser(id) {
      const { error } = await supabase.rpc('admin_delete_user', { target: id });
      if (error) fail('admin_delete_user', error);
    },
  };
}
