import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerSupabase } from '@/shared/supabase/server';
import { HEALTH_ALERT_STOP_PAGE as STOP_PAGE, handleStopHealthAlert, stopHealthAlert } from './health-alert';

vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: vi.fn() }));

const SITE = 'https://xomoni.test';
const TOKEN = '3f2a6c1e-9b7d-4e8a-a1c2-5d6e7f8091ab';

const post = (query: string, body = '', headers: Record<string, string> = {}) =>
  new NextRequest(`${SITE}/api/health-alert/stop${query}`, { method: 'POST', body, headers });

afterEach(() => vi.clearAllMocks());

describe('stopping the health alert (#407, ADR-0042)', () => {
  it('stops it from the stop page’s button and goes back to the page, saying so', async () => {
    const stop = vi.fn(() => Promise.resolve(true));
    const response = await handleStopHealthAlert(post(`?token=${TOKEN}`), stop);
    expect(stop).toHaveBeenCalledWith(TOKEN);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}${STOP_PAGE}?stopped=1`);
  });

  it('answers a mail app’s one-click stop plainly, from any origin and without a session', async () => {
    const stop = vi.fn(() => Promise.resolve(true));
    const response = await handleStopHealthAlert(
      post(`?token=${TOKEN}`, 'List-Unsubscribe=One-Click', {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://mail.example',
      }),
      stop,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('The alert is stopped.');
  });

  it('asks nothing for a link that isn’t one', async () => {
    const stop = vi.fn(() => Promise.resolve(true));
    const page = await handleStopHealthAlert(post('?token=nope'), stop);
    expect(page.headers.get('location')).toBe(`${SITE}${STOP_PAGE}`);
    const oneClick = await handleStopHealthAlert(post('', 'List-Unsubscribe=One-Click'), stop);
    expect(oneClick.status).toBe(400);
    expect(stop).not.toHaveBeenCalled();
  });

  it('says it failed when the database can’t be asked, keeping the link to try again', async () => {
    const stop = vi.fn(() => Promise.resolve(false));
    const page = await handleStopHealthAlert(post(`?token=${TOKEN}`), stop);
    expect(page.headers.get('location')).toBe(`${SITE}${STOP_PAGE}?token=${TOKEN}&failed=1`);
    const oneClick = await handleStopHealthAlert(post(`?token=${TOKEN}`, 'List-Unsubscribe=One-Click'), stop);
    expect(oneClick.status).toBe(503);
  });

  it('asks the database through stop_health_alert, with the token only', async () => {
    const rpc = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(createServerSupabase).mockResolvedValue({ rpc } as never);
    expect(await stopHealthAlert(TOKEN)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('stop_health_alert', { token: TOKEN });
    rpc.mockResolvedValueOnce({ error: { message: 'down' } } as never);
    expect(await stopHealthAlert(TOKEN)).toBe(false);
  });

  it('uses the real stop when none is given', async () => {
    const rpc = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(createServerSupabase).mockResolvedValue({ rpc } as never);
    const response = await handleStopHealthAlert(post(`?token=${TOKEN}`));
    expect(response.headers.get('location')).toBe(`${SITE}${STOP_PAGE}?stopped=1`);
  });
});
