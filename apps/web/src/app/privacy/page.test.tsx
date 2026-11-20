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
});
