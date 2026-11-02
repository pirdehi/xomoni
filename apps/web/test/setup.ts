// Runs before every unit test file (vitest.config.ts `test.setupFiles`): DOM matchers such as
// `toBeInTheDocument`, and unmounting whatever a component test rendered.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
