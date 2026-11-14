import { createBrowserSupabase } from '@/shared/supabase/browser';
import { connectBrowser } from '../application/connect-browser';
import type { ConnectOutcome, ConnectRequest } from '../domain/connect';
import { createChromeExtensionLink } from '../infrastructure/chrome-extension-link';
import { createSupabaseDevicePairing } from '../infrastructure/supabase-dashboard';

/** What the connect page can do. */
export interface ConnectServices {
  /** Makes a one-time code and hands it to the extension that asked (#228). */
  connect(request: ConnectRequest): Promise<ConnectOutcome>;
}

/** Composition root for `/connect`: the browser Supabase client for the code, `chrome.runtime` for the hand-over. */
export function createConnectServices(): ConnectServices {
  const pairing = createSupabaseDevicePairing(createBrowserSupabase());
  const link = createChromeExtensionLink();
  return { connect: (request) => connectBrowser({ pairing, link }, request) };
}
