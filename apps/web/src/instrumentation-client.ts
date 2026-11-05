// Runs in the browser before React hydrates the page (Next.js's `instrumentation-client` convention).
import { installTrustedTypesPolicy } from '@/shared/config/trusted-types';

// Trusted Types (#147, ADR-0014): the CSP refuses strings at script sinks unless this policy lets them through.
installTrustedTypesPolicy(window);
