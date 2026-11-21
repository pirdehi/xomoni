// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OneClickUpdate, UpdateRecovery, UpdatesCard } from '../../src/ui/components/OneClickUpdate.store';

// The built store bundle is checked by tooling/store-build.test.mjs; these are what it puts in place of the updater.
describe('the store build’s stand-in for one-click updates (#305)', () => {
  it('shows nothing: the store updates Xomoni', () => {
    const { container } = render(
      <>
        <OneClickUpdate version="0.5.0" />
        <UpdatesCard />
        <UpdateRecovery />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
