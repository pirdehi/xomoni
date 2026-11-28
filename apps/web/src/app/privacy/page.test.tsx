// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrivacyPage from './page';

describe('the privacy policy', () => {
  it('names what two-step verification keeps, only when turned on, and its notices (#173)', () => {
    render(<PrivacyPage />);
    const item = screen.getByText('Authenticator apps, only if you turn on two-step verification:').closest('li');
    expect(item).toHaveTextContent('the shared key your app makes its codes from');
    expect(item).toHaveTextContent('Removing an app, or deleting your account, deletes them.');
    expect(screen.getByText(/security notices when your password/)).toHaveTextContent('or authenticator apps change');
  });

  it('names the daily numbers before they can be sent: counts only, by choice, deleted when turned off (#250)', () => {
    render(<PrivacyPage />);
    const item = screen.getByText('Daily numbers, only if you turn them on:').closest('li');
    expect(item).toHaveTextContent('made only of counts');
    expect(item).toHaveTextContent('Never the text, ID or link of a post, and never anyone else’s name.');
    expect(item).toHaveTextContent('Turning it off deletes every day already sent');
    expect(item).toHaveTextContent('it never asks X for them');
  });

  it('says what xomoni.com shows from the extension stays in the browser, and work on X is confirmed there (ADR-0028)', () => {
    render(<PrivacyPage />);
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'What xomoni.com shows from the extension in the same browser',
    });
    const section = heading.nextElementSibling;
    expect(section).toHaveTextContent('It never passes through our servers.');
    expect(section).toHaveTextContent('it isn’t stored, logged or sent to anyone');
    expect(section?.nextElementSibling).toHaveTextContent(
      'always confirmed by you in the extension, never on this website',
    );
  });

  it('names the replies kept on the computer with their limits, and the move file never uploaded (ADR-0030, ADR-0032)', () => {
    render(<PrivacyPage />);
    const kept = screen.getByText(/keeps the replies other people wrote to your posts/);
    expect(kept).toHaveTextContent('at most the last 90 days and 5,000 replies per X account, on your computer only');
    expect(kept).toHaveTextContent('Xomoni never uploads it.');
  });

  // Exactly what reaches xomoni.com, with the daily numbers on and off (ADR-0004, ADR-0026, #450).
  it('names the daily numbers among what an account stores, only while on, and nothing else from the extension', () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/If you create an account, we store/)).toHaveTextContent(
      'If you create an account, we store your email address (and name, if you give one), the browsers you connect, summaries of your jobs and, only while you have them on, your daily numbers. Nothing else from the extension reaches us.',
    );
    const deleting = screen.getByRole('heading', {
      level: 2,
      name: 'Keeping and deleting your data',
    }).nextElementSibling;
    expect(deleting).toHaveTextContent('Turning your daily numbers off deletes every day already sent.');
    expect(deleting).toHaveTextContent('removes your account, browsers, job summaries and daily numbers immediately');
  });

  it('describes both ways to connect a browser, keeping codes and keys only as one-way hashes (ADR-0024)', () => {
    render(<PrivacyPage />);
    const item = screen.getByText('Connected browsers:').closest('li');
    expect(item).toHaveTextContent('in one click on this website, in the same browser');
    expect(item).toHaveTextContent('or by typing that code from your dashboard into the extension');
    expect(item).toHaveTextContent('only as one-way hashes');
  });

  it('says what the alert when X warns an account keeps, only while it is on, and for how long (#407, ADR-0047)', () => {
    render(<PrivacyPage />);
    const alert = screen.getByText(/we also email you when X warns one of your X accounts/);
    expect(alert).toHaveTextContent('nothing X showed and nothing you posted');
    expect(alert).toHaveTextContent(
      'While it is on, and only then, we keep for each of your X accounts the highest risk level',
    );
    expect(alert).toHaveTextContent('for a week after it was sent or dropped');
    expect(alert).toHaveTextContent('Turning the alert off deletes the levels at once');
    expect(screen.getByText(/Delete my Xomoni account/).closest('p')).toHaveTextContent(
      'with everything kept for the alert when X warns your account',
    );
  });
});

describe('the privacy policy and paid plans (#420)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('says nothing of paid plans or Polar while the server keeps those pages off', () => {
    vi.stubEnv('BILLING_PAGES', undefined);
    render(<PrivacyPage />);
    const main = screen.getByRole('main');
    expect(main.textContent).not.toMatch(/Polar|paid plan|Your plan/);
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });

  it('names Polar as the merchant of record, and says what is kept about a plan, as a draft', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<PrivacyPage />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('The parts about paid plans wait for the maintainer’s approval');
    const plan = screen.getByText('Your plan, only if you buy one:').closest('li');
    expect(plan).toHaveTextContent('the plan (Free, Plus or Pro), its status, when it ends or renews');
    expect(plan).toHaveTextContent('never its contents');
    expect(plan).toHaveTextContent('Never your card, your billing address or anything about your X account.');
    expect(plan).toHaveTextContent('Deleting your account deletes your plan.');
    const polar = screen.getByText('Polar', { selector: 'strong' }).closest('li');
    expect(polar).toHaveTextContent('sells our paid plans as merchant of record');
    expect(polar).toHaveTextContent('never anything about your X account');
    expect(screen.getByText(/Polar takes the payment as our merchant of record/)).toHaveTextContent(
      'We never see your card, and we keep only your plan.',
    );
    expect(screen.getByText(/deleting your account cancels your subscription at Polar first/)).toBeInTheDocument();
  });
});
