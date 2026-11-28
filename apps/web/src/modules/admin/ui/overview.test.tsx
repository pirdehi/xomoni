// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { OVERVIEW_JSON } from '@test/fakes/admin-console';
import { parseOverview } from '../domain/overview';
import { ConsoleOverview } from './overview';

const overview = parseOverview(OVERVIEW_JSON);

describe('ConsoleOverview (#516)', () => {
  it('shows each count as a tile, with what it is out of', () => {
    render(<ConsoleOverview overview={overview} today="2026-11-28" />);
    const tile = (name: string) => screen.getByRole('group', { name });
    expect(tile('Accounts')).toHaveTextContent('120');
    expect(tile('Accounts')).toHaveTextContent('100 confirmed');
    expect(tile('New in 7 days')).toHaveTextContent('931 in 30 days');
    expect(tile('Signed in, 30 days')).toHaveTextContent('64');
    expect(tile('With two-step verification')).toHaveTextContent('12');
    expect(tile('Suspended')).toHaveTextContent('2');
    expect(tile('Browsers connected')).toHaveTextContent('41 active in 7 days');
    expect(tile('Jobs running')).toHaveTextContent('4 waiting');
    expect(tile('Jobs finished, 7 days')).toHaveTextContent('900 in all');
    expect(tile('Weekly email')).toHaveTextContent('13 with X warnings');
  });

  it('charts sign-ups per day for 30 days, with every value in a table too', async () => {
    render(<ConsoleOverview overview={overview} today="2026-11-28" />);
    const chart = screen.getByRole('region', { name: 'Sign-ups per day' });
    expect(within(chart).getByRole('img', { name: 'Sign-ups: 7 in all' })).toBeInTheDocument();
    await userEvent.click(within(chart).getByRole('button', { name: 'Show as table' }));
    const table = within(chart).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(31);
    expect(within(table).getByRole('row', { name: 'Nov 28 5' })).toBeInTheDocument();
  });

  it('lists the versions in use, most first, and the plans', () => {
    render(<ConsoleOverview overview={overview} today="2026-11-28" />);
    const versions = screen.getByRole('region', { name: 'Xomoni versions in use' });
    expect(
      within(versions)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual(['VersionBrowsers', '0.6.150', '0.6.030']);
    const plans = screen.getByRole('region', { name: 'Plans' });
    expect(within(plans).getByRole('row', { name: 'Plus 8' })).toBeInTheDocument();
  });

  it('says so when nothing is connected or bought yet', () => {
    render(<ConsoleOverview overview={parseOverview({})} today="2026-11-28" />);
    expect(screen.getByText('No browser connected yet.')).toBeInTheDocument();
    expect(screen.getByText('No plan yet.')).toBeInTheDocument();
  });

  it('says so when the database couldn’t give it', () => {
    render(<ConsoleOverview overview={null} today="2026-11-28" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load the overview.');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
