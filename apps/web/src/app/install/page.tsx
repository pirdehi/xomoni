import type { Metadata } from 'next';
import { InstallPage } from '@/modules/landing/ui/install-page';

export const metadata: Metadata = {
  title: 'Install',
  description: 'Install the Xomoni extension from its latest release, in Chrome, Edge or Brave.',
};

/** `/install`: the install guide (#44, `modules/landing`). */
export default function Install() {
  return <InstallPage />;
}
