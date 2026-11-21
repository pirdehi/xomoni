// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from './page';

describe('the privacy policy', () => {
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

  it('describes both ways to connect a browser, keeping codes and keys only as one-way hashes (ADR-0024)', () => {
    render(<PrivacyPage />);
    const item = screen.getByText('Connected browsers:').closest('li');
    expect(item).toHaveTextContent('in one click on this website, in the same browser');
    expect(item).toHaveTextContent('or by typing that code from your dashboard into the extension');
    expect(item).toHaveTextContent('only as one-way hashes');
  });
});
