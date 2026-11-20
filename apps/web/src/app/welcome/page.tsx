import type { Metadata } from 'next';
import { AuthCard } from '@/modules/auth/ui/auth-card';
import { Welcome } from '@/modules/extension/ui/welcome';

export const metadata: Metadata = { title: 'Welcome', robots: { index: false, follow: false } };

/** `/welcome`: what Xomoni opens once installed (#244): the one sign-in, or going on without an account. */
export default function WelcomePage() {
  return (
    <AuthCard title="Welcome to Xomoni" description="Three steps, and you can follow Xomoni from any device.">
      <Welcome />
    </AuthCard>
  );
}
