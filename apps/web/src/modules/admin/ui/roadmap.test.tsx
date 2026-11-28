// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DIRECTION_PLAN_JSON, PLAN_JSON } from '@test/fakes/admin-console';
import { parsePlan } from '../domain/plan';
import { Roadmap } from './roadmap';

const published = { plan: parsePlan(PLAN_JSON), updatedAt: '2026-11-28T06:05:00Z' };

describe('Roadmap (#516)', () => {
  const steered = { plan: parsePlan({ ...PLAN_JSON, ...DIRECTION_PLAN_JSON }), updatedAt: '2026-11-28T06:05:00Z' };

  it('leads with the sources, linking only web addresses', () => {
    render(<Roadmap published={steered} />);
    const sources = screen.getByRole('region', { name: 'Sources' });
    expect(within(sources).getByRole('link', { name: 'موتور برند' })).toHaveAttribute(
      'href',
      'https://xomoni.com/product/document',
    );
    expect(within(sources).queryByRole('link', { name: 'منبع خراب' })).not.toBeInTheDocument();
    expect(within(sources).getByText('منبع خراب')).toBeInTheDocument();
  });

  it('shows the single direction, stage by stage in order, with R1’s live tasks in its stage', () => {
    render(<Roadmap published={steered} />);
    const direction = screen.getByRole('region', { name: 'Direction' });
    expect(within(direction).getByRole('heading', { name: 'مسیر واحد' })).toHaveAttribute('dir', 'auto');
    const stages = within(direction).getAllByRole('article', { name: /^Stage / });
    expect(stages.map((st) => st.getAttribute('aria-label'))).toEqual(['Stage 1', 'Stage 2']);
    const [first, second] = stages as [HTMLElement, HTMLElement];
    expect(within(first).getByText('اولین نسخه‌ی فروشی')).toBeInTheDocument();
    expect(first).toHaveTextContent('In progress');
    expect(first).toHaveTextContent('0.7.0');
    expect(first).toHaveTextContent('Gate: دروازه‌ی انتشار');
    expect(
      within(first).getByRole('img', { name: /R1 tasks, 12 of 56 merged: 12 merged, 20 in ci/ }),
    ).toBeInTheDocument();
    expect(first).toHaveTextContent('Issues: 2 of 4 closed');
    expect(second).toHaveTextContent('Waits on your decision');
    expect(second).toHaveTextContent('Decided موتور AI');
    // A source the plan doesn't list is left out rather than shown as a bare id.
    expect(within(second).getByRole('link', { name: 'پروژه‌ی جامع X' })).toBeInTheDocument();
    expect(second).not.toHaveTextContent('missing');
    expect(within(direction).getByRole('group', { name: 'Later' })).toHaveTextContent('بیمه‌ی تعلیق');
    expect(within(direction).getByRole('group', { name: 'Parked' })).toHaveTextContent('ایمیل');
  });

  it('shows the program’s R1 lane by lane, what waits on the founder, and a note when it is behind GitHub', () => {
    render(<Roadmap published={steered} />);
    const program = screen.getByRole('region', { name: 'X gaps program, R1' });
    expect(program).toHaveTextContent('2 tasks merged on GitHub still show as open in the program');
    expect(program).toHaveTextContent('Merged 12');
    expect(program).toHaveTextContent('Waiting on you 1');
    expect(within(program).getByRole('link', { name: 'CB.1 #420' })).toHaveAttribute(
      'href',
      'https://github.com/pirdehi/xomoni/issues/420',
    );
    expect(program).toHaveTextContent('تصمیم و داده · 4 of 5 merged');
    expect(program).toHaveTextContent('پیش از کد · 2 of 2 merged · closed');
    const waits = within(program).getByRole('group', { name: 'The program waits on you for' });
    expect(within(waits).getByRole('link', { name: '#462' })).toHaveAttribute(
      'href',
      'https://github.com/pirdehi/xomoni/pull/462',
    );
    expect(waits).toHaveTextContent('حساب Polar');
    expect(within(program).getByRole('group', { name: 'Merged lately' })).toHaveTextContent('#447 Polar ساختگی');
  });

  it('leaves the direction, program and sources out of a plan published before them', () => {
    render(<Roadmap published={published} />);
    expect(screen.queryByRole('region', { name: 'Direction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'X gaps program, R1' })).not.toBeInTheDocument();
  });

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
