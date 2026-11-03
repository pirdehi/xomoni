// Runs before every unit test file (vitest.config.ts `test.setupFiles`): DOM matchers such as
// `toBeInTheDocument`, and unmounting whatever a component test rendered.
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { afterEach } from 'vitest';

// `findBy…` and `waitFor` wait up to 5 s: the full suite runs many files in parallel, and a page that renders
// hundreds of rows can take more than the default second under that load.
configure({ asyncUtilTimeout: 5000 });

// Fluent UI's styles (Griffel) are not inserted into the test DOM: tests assert behavior through roles, ARIA and
// `data-*` attributes, never computed CSS, and parsing thousands of generated rules in happy-dom made component tests
// about a third slower, enough to push them past their waits on a busy machine (ADR-0019).
if (typeof CSSStyleSheet !== 'undefined') CSSStyleSheet.prototype.insertRule = () => 0;

// happy-dom's Web Animations are partial: cancelling one rejects its `finished` promise with nothing to catch it,
// which Fluent UI's motion does whenever an accordion panel or dialog closes. Without `animate`, Fluent skips its
// animations, as it does in browsers without the API (ADR-0019).
if (typeof Element !== 'undefined') Reflect.deleteProperty(Element.prototype, 'animate');

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
