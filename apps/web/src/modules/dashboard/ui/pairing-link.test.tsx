// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PairingLink } from './pairing-link';

describe('PairingLink (#182)', () => {
  it('marches dashes, without dots, while waiting', () => {
    const { container } = render(<PairingLink state="waiting" />);
    const link = container.firstElementChild!;
    expect(link).toHaveAttribute('data-state', 'waiting');
    expect(link).toHaveAttribute('aria-hidden', 'true');
    expect(link.children[1]!.childElementCount).toBe(0);
  });

  it('sends three dots along the line once connected', () => {
    const { container } = render(<PairingLink state="connected" />);
    const link = container.firstElementChild!;
    expect(link).toHaveAttribute('data-state', 'connected');
    expect(link.children[1]!.childElementCount).toBe(3);
  });
});
