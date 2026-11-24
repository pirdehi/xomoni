import type { Metadata } from 'next';
import { digestList } from '@/modules/algorithm/server/digests';
import { DigestList } from '@/modules/algorithm/ui/digest-list';

/** The list is the same for every visitor: made ahead, never rendered per request. */
export const ensureStatic = 'navigation';

export const metadata: Metadata = {
  title: 'X’s ranking code, month by month',
  description:
    'A monthly digest of what changed in the code X publishes for its recommendations, made from that public code only.',
};

/** `/algorithm`: every published digest of X's open ranking code, newest first (#430, ADR-0046). */
export default function AlgorithmPage() {
  return <DigestList digests={digestList()} />;
}
