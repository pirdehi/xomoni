'use client';
// The home page's call to install (#243): on a computer, the install button as it is; on a phone or tablet, where Xomoni
// can't be installed, *Send to my computer* in its place, so the first action there gets the install guide to the
// computer. The device is read only after hydration (`usePlatform`), so the server renders the computer's button and
// the browser's first render agrees with it.
import type { ReactNode } from 'react';
import { INSTALL_PAGE_URL } from '@/shared/config/site';
import { SendToComputer } from '@/modules/extension/ui/send-to-computer';
import { usePlatform } from './install-guide';

/**
 * `children` (the install button) on a computer, and on a phone *Send to my computer* with the install guide's address
 * (`INSTALL_PAGE_URL`), as large as the button it replaces; `align="center"` under centered text, such as the hero's.
 */
export function InstallOrSend({ align = 'start', children }: { align?: 'start' | 'center'; children: ReactNode }) {
  const platform = usePlatform();
  return platform.phone ? <SendToComputer url={INSTALL_PAGE_URL} size="large" align={align} /> : children;
}
