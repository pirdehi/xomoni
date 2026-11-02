// Runs before every test file (vite.config.ts `test.setupFiles`): DOM matchers such as `toBeInTheDocument`,
// and unmounting whatever a component test rendered, so tests never see each other's DOM.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
