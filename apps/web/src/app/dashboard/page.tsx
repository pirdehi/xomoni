import type { Metadata } from 'next';
import { DashboardScreen } from './screen';

export const metadata: Metadata = { title: 'Dashboard' };

/** `/dashboard`: the dashboard's Overview (#245). */
export default function DashboardPage() {
  return <DashboardScreen />;
}
