// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN, GRACE_ID, USER_JSON } from '@test/fakes/admin-console';
import { parseUserDetail, type UserDetail } from '../domain/users';
import { UserDetailView } from './user-detail';

vi.mock('../server/actions', () => ({
  signOutUserEverywhere: vi.fn(),
  setUserSuspended: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

const grace = parseUserDetail(USER_JSON) as UserDetail;
const facts = (title: string) => screen.getByRole('region', { name: title });

describe('UserDetailView (#516)', () => {
  it('shows who the account is, how it signs in and how many sessions it has', () => {
    render(<UserDetailView user={grace} viewerId={ADMIN.id} />);
    expect(screen.getByRole('heading', { level: 1, name: 'grace@example.com' })).toBeInTheDocument();
    const account = facts('Account');
    expect(account).toHaveTextContent(GRACE_ID);
    expect(account).toHaveTextContent('Joined1 Nov 2026, 09:00 UTC');
    expect(account).toHaveTextContent('Sign-in methodsPassword, Google');
    expect(account).toHaveTextContent('Two-step verificationOff');
    expect(account).toHaveTextContent('SuspendedNo');
    expect(account).toHaveTextContent('Signed-in sessions3');
    expect(screen.getByRole('link', { name: 'All users' })).toHaveAttribute('href', '/product/users');
  });

  it('shows the plan and what the account chose to receive', () => {
    render(<UserDetailView user={grace} viewerId={ADMIN.id} />);
    const plan = facts('Plan and choices');
    expect(plan).toHaveTextContent('PlanPlus (active)');
    expect(plan).toHaveTextContent('Valid until31 Dec 2026');
    expect(plan).toHaveTextContent('Daily numbersYes');
    expect(plan).toHaveTextContent('Weekly emailNo');
    expect(plan).toHaveTextContent('Email when X warnsYes');
  });

  it('lists its browsers and its recent jobs, status only', () => {
    render(<UserDetailView user={grace} viewerId={ADMIN.id} />);
    expect(within(facts('Browsers')).getByRole('row', { name: /Chrome on macOS/ })).toHaveTextContent('0.6.1');
    const job = within(facts('Recent jobs')).getByRole('row', { name: /Delete posts before 2024/ });
    expect(job).toHaveTextContent('@grace');
    expect(job).toHaveTextContent('12 of 40');
  });

  it('marks a suspension until restored, never with the far-off date the database stores', () => {
    render(<UserDetailView user={{ ...grace, banned: true }} viewerId={ADMIN.id} />);
    expect(facts('Account')).toHaveTextContent('SuspendedYes, until restored');
    expect(screen.queryByText(/9999/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-badge="suspended"]')).toHaveTextContent('Suspended');
  });

  it('says when it has no browser, no job and no paid plan, and lists sessions when given', () => {
    render(
      <UserDetailView
        user={{
          ...grace,
          plan: { tier: 'free', status: null, validUntil: null },
          devices: [],
          jobs: [],
          sessions: [{ id: 's1', createdAt: null, updatedAt: null, userAgent: 'Firefox', aal: 'aal2' }],
          sessionCount: 1,
        }}
        viewerId={ADMIN.id}
      />,
    );
    expect(screen.getByText('No browser connected.')).toBeInTheDocument();
    expect(screen.getByText('No job reported.')).toBeInTheDocument();
    expect(facts('Plan and choices')).toHaveTextContent('PlanFree');
    expect(within(facts('Sessions')).getByRole('row', { name: /Firefox/ })).toHaveTextContent('With a code');
  });

  it('offers the actions on someone else’s account only', () => {
    const { rerender } = render(<UserDetailView user={grace} viewerId={ADMIN.id} />);
    expect(within(facts('Actions')).getByRole('button', { name: 'Sign out everywhere' })).toBeInTheDocument();
    rerender(<UserDetailView user={{ ...grace, id: ADMIN.id }} viewerId={ADMIN.id} />);
    expect(within(facts('Actions')).queryByRole('button')).not.toBeInTheDocument();
  });
});
