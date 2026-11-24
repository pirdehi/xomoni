import type { Metadata } from 'next';
import { digestList, digestMonths, digestOr404 } from '@/modules/algorithm/server/digests';
import { DigestPage } from '@/modules/algorithm/ui/digest-page';

/**
 * The whole page is made ahead, never streamed per request: an address no digest has is rendered in full before it is
 * served, so its 404 is the response's status, not only the page's text (ADR-0046).
 */
export const ensureStatic = 'navigation';

/** The address's segment after `/algorithm/`: a month, `yyyy-mm`. */
type Props = { params: Promise<{ month: string }> };

/** Every published digest's page is built ahead; any other address, a draft's included, answers 404. */
export function generateStaticParams() {
  return digestMonths().map((month) => ({ month }));
}

/** The page's title: the digest's month, or the list's name for an address with no digest. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { month } = await params;
  const digest = digestList().find((d) => d.month === month);
  return digest
    ? {
        title: `X’s ranking code: ${digest.month}`,
        description: `What changed in X’s open ranking code, ${digest.month}.`,
      }
    : { title: 'X’s ranking code, month by month' };
}

/** `/algorithm/<yyyy-mm>`: one month's published digest (#430, ADR-0046); a draft or an unknown month is a 404. */
export default async function AlgorithmMonthPage({ params }: Props) {
  const { month } = await params;
  return <DigestPage digest={digestOr404(month)} />;
}
