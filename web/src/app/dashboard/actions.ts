'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Deletes the Xomoni account; devices and job summaries cascade. Nothing on X is touched. */
export async function deleteAccount() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login');

  const { error } = await supabase.rpc('delete_account');
  if (error) return { error: error.message };

  await supabase.auth.signOut({ scope: 'local' });
  redirect('/?account=deleted');
}
