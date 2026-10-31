import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { addDevice, addJobs, createConfirmedUser } from './support/admin';
import { PASSWORD, uniqueEmail } from './support/flows';

// Real Supabase Realtime, no browser: these tests open no page, so they skip the CSP guard in support/test.ts.

const supabase = () =>
  createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_PUBLISHABLE_KEY ?? '', {
    auth: { persistSession: false },
  });

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = supabase();
  // The local stack's Turnstile secret accepts any token.
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
    options: { captchaToken: 'e2e' },
  });
  if (error) throw error;
  await client.realtime.setAuth();
  return client;
}

/** Joins `viewerId`'s dashboard channel as the website does; resolves once it is live or refused. */
function joinDashboard(client: SupabaseClient, viewerId: string): Promise<{ status: string; titles: string[] }> {
  const titles: string[] = [];
  return new Promise((resolve) => {
    client
      .channel(`dashboard:${viewerId}`, { config: { private: true } })
      .on<{ title: string }>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'jobs', filter: `user_id=eq.${viewerId}` },
        ({ new: row }) => titles.push(row.title),
      )
      .on('system', {}, (msg: { extension?: string; status?: string }) => {
        if (msg.extension === 'postgres_changes' && msg.status === 'ok') resolve({ status: 'live', titles });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve({ status, titles });
      });
  });
}

test.describe('dashboard Realtime channel (#81)', () => {
  test('admits only its owner, who still gets live changes', async () => {
    const ownerEmail = uniqueEmail('rt-owner');
    const otherEmail = uniqueEmail('rt-other');
    const ownerId = await createConfirmedUser(ownerEmail, PASSWORD);
    await createConfirmedUser(otherEmail, PASSWORD);
    const clients = [await signedIn(ownerEmail), await signedIn(otherEmail), supabase()];
    const [owner, other, anonymous] = clients;

    const mine = await joinDashboard(owner, ownerId);
    expect(mine.status).toBe('live');
    expect((await joinDashboard(other, ownerId)).status).toBe('CHANNEL_ERROR');
    expect((await joinDashboard(anonymous, ownerId)).status).toBe('CHANNEL_ERROR');

    const device = await addDevice(ownerId, 'Chrome on Linux');
    await addJobs(ownerId, device, [
      { local_id: 'rt', x_handle: 'rt_x', kind: 'scan', title: 'Realtime job', state: 'running' },
    ]);
    await expect.poll(() => mine.titles).toEqual(['Realtime job']);

    await Promise.all(clients.map((client) => client.removeAllChannels()));
  });
});
