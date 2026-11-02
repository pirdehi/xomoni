// Runs before every test file (vite.config.ts `test.setupFiles`): DOM matchers such as `toBeInTheDocument`,
// and unmounting whatever a component test rendered, so tests never see each other's DOM.
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { afterEach } from 'vitest';

// `findBy…` and `waitFor` wait up to 5 s: the full suite runs many files in parallel, and a page that renders
// hundreds of rows can take more than the default second under that load.
configure({ asyncUtilTimeout: 5000 });

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
