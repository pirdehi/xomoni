// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';
import { SECTIONS, type SectionId } from '../domain/sections';
import { DashboardFrame } from './dashboard-frame';

const place = (id: SectionId) => SECTIONS.find((section) => section.id === id)!;

function renderFrame(id: SectionId, query = '', accounts = ['ada', 'bob'], live = true) {
  const path = id === 'overview' ? '/dashboard' : `/dashboard/${id}`;
  setLocation(path, query);
  // The address the browser holds, which a change reads and writes (#452).
  window.history.replaceState(null, '', query ? `${path}?${query}` : path);
  return render(
    <DashboardFrame section={place(id)} accounts={accounts} live={live}>
      <p>Page content</p>
    </DashboardFrame>,
  );
}

beforeEach(() => resetNavigation());

describe('DashboardFrame (#245)', () => {
  it('lists every place in the sidebar by group, marks the current one and the ones not built yet', () => {
    renderFrame('audience');

    const sidebar = screen.getByRole('navigation', { name: 'Dashboard' });
    expect(sidebar).toHaveTextContent('Insights');
    expect(sidebar).toHaveTextContent('Manage');
    expect(sidebar).toHaveTextContent('History & account');
    const links = within(sidebar).getAllByRole('link');
    expect(links).toHaveLength(SECTIONS.length);
    const current = within(sidebar).getByRole('link', { current: 'page' });
    expect(current).toHaveTextContent('Audience');
    expect(within(sidebar).getByRole('link', { name: /^Overview/ })).not.toHaveTextContent('Soon');
    expect(within(sidebar).getByRole('link', { name: /^Comments/ })).not.toHaveTextContent('Soon');
    // Every place is built now (#257): none is marked Soon.
    expect(within(sidebar).queryByText('Soon')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Audience' })).toBeInTheDocument();
    expect(screen.getByText('Who follows you, and how that changes.')).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('keeps the account and period in every link', () => {
    renderFrame('overview', 'account=ada&period=7d');

    const sidebar = screen.getByRole('navigation', { name: 'Dashboard' });
    expect(within(sidebar).getByRole('link', { name: /^Activity/ })).toHaveAttribute(
      'href',
      '/dashboard/activity?account=ada&period=7d',
    );
    expect(within(sidebar).getByRole('link', { name: /^Overview/ })).toHaveAttribute(
      'href',
      '/dashboard?account=ada&period=7d',
    );
  });

  /** The address as the browser holds it now: path and query. */
  const address = () => `${window.location.pathname}${window.location.search}`;

  it('changes the period in the address, in place, leaving out the default', async () => {
    renderFrame('activity', 'period=7d');

    const period = screen.getByRole('combobox', { name: 'Period' });
    expect(period).toHaveValue('7d');
    await userEvent.selectOptions(period, 'Last 30 days');
    expect(address()).toBe('/dashboard/activity');
    await userEvent.selectOptions(period, 'All time');
    expect(address()).toBe('/dashboard/activity?period=all');
    // In place: no navigation, so nothing is asked of the server and the page isn't scrolled.
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  // Two quick changes, the second before the page draws the first, both land (#452). The old code built each change
  // from the scope the page last drew, so the period put the account back to All accounts.
  it('keeps the first of two quick changes, made before the page draws it', async () => {
    renderFrame('activity');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'X account' }), '@ada');
    // The page hasn't drawn the account yet: what it draws still says All accounts.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'Last 7 days');

    expect(address()).toBe('/dashboard/activity?account=ada&period=7d');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'X account' }), 'All accounts');
    expect(address()).toBe('/dashboard/activity?period=7d');
  });

  it('keeps a place’s own answers in the address when the scope changes', async () => {
    renderFrame('cleanup', 'what=posts&before=2021-01-01');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'X account' }), '@bob');

    expect(address()).toBe('/dashboard/cleanup?what=posts&before=2021-01-01&account=bob');
  });

  it('shows the other places of the group as links on a phone, and a bottom bar with More', async () => {
    renderFrame('content');

    const tabs = screen.getByRole('navigation', { name: 'Insights' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Audience', 'Content', 'Engagement', 'Reports']);
    const bar = screen.getByRole('navigation', { name: 'Dashboard, on a phone' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Overview', 'Insights', 'Comments']);
    await userEvent.click(within(bar).getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/dashboard/settings');
  });

  it('has no group links for Overview, which is alone in its group', () => {
    renderFrame('overview');
    expect(screen.queryByRole('navigation', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('names the address’s account in the picker even when no job here ran on it (#345)', () => {
    renderFrame('activity', 'account=cy');
    const picker = screen.getByRole('combobox', { name: 'X account' });
    expect(picker).toHaveValue('cy');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All accounts', '@ada', '@bob', '@cy']);
  });

  it('says when the page isn’t live', () => {
    renderFrame('overview', '', [], false);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
    expect(within(screen.getByRole('combobox', { name: 'X account' })).getAllByRole('option')).toHaveLength(1);
  });
});
