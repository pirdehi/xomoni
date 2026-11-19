import type { Metadata } from 'next';
import { sectionSlugs, sectionTitle } from '@/modules/dashboard/server/sections';
import { DashboardScreen } from '../screen';

/** The address's segment after `/dashboard/`. */
type Props = { params: Promise<{ section: string }> };

/** The places are a fixed list, so the route names them, and Next.js knows their addresses ahead. */
export function generateStaticParams() {
  return sectionSlugs().map((section) => ({ section }));
}

/** The page's title: the place's name. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: sectionTitle((await params).section) };
}

/** `/dashboard/<place>`: one place of the dashboard; an unknown one shows the not-found page (#245). */
export default function DashboardSectionPage({ params }: Props) {
  return <DashboardScreen slug={params.then((p) => p.section)} />;
}
