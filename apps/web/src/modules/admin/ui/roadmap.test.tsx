// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PLAN_JSON } from '@test/fakes/admin-console';
import { parsePlan } from '../domain/plan';
import { Roadmap } from './roadmap';

const published = { plan: parsePlan(PLAN_JSON), updatedAt: '2026-11-28T06:05:00Z' };

describe('Roadmap (#516)', () => {
  it('says when it was published, and how work flows', () => {
    render(<Roadmap published={published} />);
    expect(screen.getByText('Published 28 Nov 2026, 06:05 UTC')).toBeInTheDocument();
    const flow = screen.getByRole('region', { name: 'How work flows' });
    expect(flow).toHaveTextContent('Latest release0.6.1');
    expect(flow).toHaveTextContent('Open pull requests4');
    expect(flow).toHaveTextContent('Merged in 7 days18');
    expect(flow).toHaveTextContent('Failing checks0');
    // Not measured: left out rather than shown as zero.
    expect(flow).not.toHaveTextContent('With conflicts');
  });

  it('shows Now, Next and Later, each item with its progress and its issues, Persian words in their own direction', () => {
    render(<Roadmap published={published} />);
    const now = screen.getByRole('group', { name: 'Now' });
    expect(within(now).getByRole('heading', { name: 'Now (1)' })).toBeInTheDocument();
    const title = within(now).getByText('کنسول مدیریت');
    expect(title).toHaveAttribute('dir', 'auto');
    expect(within(now).getByText('برای اداره محصول')).toHaveAttribute('dir', 'auto');
    expect(within(now).getByRole('progressbar', { name: 'کنسول مدیریت: 38%' })).toBeInTheDocument();
    expect(now).toHaveTextContent('38% · 3 of 8 done · 1 waiting on you');
    const issue = within(now).getByRole('link', { name: '#516 Super-admin console' });
    expect(issue).toHaveAttribute('href', 'https://github.com/pirdehi/xomoni/issues/516');
    expect(issue).toHaveAttribute('target', '_blank');
    // A link that isn't a web address is shown as text, never followed.
    expect(within(now).queryByRole('link', { name: /Bad link/ })).not.toBeInTheDocument();
    expect(within(now).getByText('#517 Bad link')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Next' })).getByText('Nothing here.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Later' })).getByText('ایمیل')).toBeInTheDocument();
  });

  it('shows the objectives’ key results against their targets', () => {
    render(<Roadmap published={published} />);
    const objectives = screen.getByRole('region', { name: 'Objectives' });
    expect(objectives).toHaveTextContent('کاربران فعال · 420 of 1,000 users · measured by the tool');
    expect(objectives).toHaveTextContent('نرخ ریزش · Not measured yet');
  });

  it('lists what waits on the founder with its age, the phases with their progress, and the lanes', () => {
    render(<Roadmap published={published} />);
    const founder = screen.getByRole('region', { name: 'Waiting on the founder' });
    expect(within(founder).getByRole('link', { name: 'انتخاب قیمت' })).toHaveAttribute('href', 'https://example.com/d');
    expect(founder).toHaveTextContent('3 days');
    const phases = screen.getByRole('region', { name: 'Phases' });
    expect(within(phases).getByRole('progressbar', { name: 'Phase 19: Release gate: 100%' })).toBeInTheDocument();
    expect(phases).toHaveTextContent('100% · 9 of 10 done');
    const lanes = screen.getByRole('region', { name: 'Lanes' });
    expect(lanes).toHaveTextContent('3 open of 2');
    expect(lanes).toHaveTextContent('Over its limit');
    expect(screen.getByRole('region', { name: 'North star' })).toHaveTextContent('42');
  });

  it('falls back on ids and English titles, and leaves out what wasn’t given', () => {
    const sparse = parsePlan({
      release: {},
      northStar: { title: 'Weekly cleaners' },
      flow: { openPRs: 2 },
      objectives: [{ id: 'o', title: 'Grow', keyResults: [{ id: 'k', titleFa: 'هدف', target: 10, value: null }] }],
      horizons: { now: [{ id: 'bare', issueList: [{ title: 'Plain', status: '' }] }] },
      founder: [{ title: 'Decide', ageDays: null, link: 'ftp://x' }],
      phases: [{ title: 'Unnumbered', counts: { waiting: 2 }, total: 2 }],
      lanes: [{ id: 'ops' }],
    });
    render(<Roadmap published={{ plan: sparse, updatedAt: '2026-11-28T06:05:00Z' }} />);
    const flow = screen.getByRole('region', { name: 'How work flows' });
    expect(flow).toHaveTextContent('Open pull requests2');
    expect(flow).not.toHaveTextContent('Latest release');
    expect(screen.getByRole('region', { name: 'North star' })).toHaveTextContent('Weekly cleanersNot measured yet');
    expect(screen.getByRole('region', { name: 'Objectives' })).toHaveTextContent('Grow');
    expect(screen.getByRole('region', { name: 'Objectives' })).toHaveTextContent('هدف · Target 10');
    const now = screen.getByRole('group', { name: 'Now' });
    expect(now).toHaveTextContent('bare');
    expect(within(now).getByText('Plain')).toBeInTheDocument();
    expect(within(now).queryByRole('link')).not.toBeInTheDocument();
    const founder = screen.getByRole('region', { name: 'Waiting on the founder' });
    expect(within(founder).queryByRole('link')).not.toBeInTheDocument();
    expect(founder).toHaveTextContent('Decide——');
    const phases = screen.getByRole('region', { name: 'Phases' });
    expect(phases).toHaveTextContent('Unnumbered');
    expect(phases).toHaveTextContent('0% · 0 of 2 done · 2 waiting');
    expect(screen.getByRole('region', { name: 'Lanes' })).toHaveTextContent('ops0 open');
  });

  it('tolerates a plan with almost nothing in it', () => {
    render(<Roadmap published={{ plan: parsePlan({}), updatedAt: '2026-11-28T06:05:00Z' }} />);
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Phases' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'North star' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Nothing here.')).toHaveLength(3);
  });

  it('says when the plan hasn’t been published yet, or couldn’t load', () => {
    const { rerender } = render(<Roadmap published={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('The plan hasn’t been published yet.');
    rerender(<Roadmap published={null} failed />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load the plan.');
  });
});
