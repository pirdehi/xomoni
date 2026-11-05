import { expect, test } from '@playwright/test';
import { REALTIME_SUBSCRIBE_STATES, createClient, type SupabaseClient } from '@supabase/supabase-js';
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
      // The database broadcasts each change of the owner's rows here (#149).
      .on('broadcast', { event: 'INSERT' }, ({ payload }) => {
        const { table, record } = payload as { table?: string; record?: { title?: string } };
        if (table === 'jobs' && record?.title) titles.push(record.title);
      })
      .subscribe((status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) resolve({ status: 'live', titles });
        if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR || status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT)
          resolve({ status, titles });
      });
  });
}

test.describe('dashboard Realtime channel (#81)', () => {
  test('admits only its owner, who still gets live changes', async () => {
    const ownerEmail = uniqueEmail('rt-owner');
    const otherEmail = uniqueEmail('rt-other');
    const ownerId = await createConfirmedUser(ownerEmail, PASSWORD);
    await createConfirmedUser(otherEmail, PASSWORD);
    const [owner, other, anonymous] = [await signedIn(ownerEmail), await signedIn(otherEmail), supabase()] as const;
    const clients = [owner, other, anonymous];

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
