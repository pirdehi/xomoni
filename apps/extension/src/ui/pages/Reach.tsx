import { makeStyles, tokens } from '@fluentui/react-components';
import { DataTrending20Regular, Info20Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { fmtAgo, fmtNumber } from '../format';
import type { PageProps } from '../navigation';
import { PLUS_RANGES, type ReachData, type ReachRange, useReachData } from '../reach';
import { useLiveQuery } from 'dexie-react-hooks';
import { labelMonths } from '../../shared/vault/label-months';
import { LabelHistory } from '../components/reach/LabelHistory';
import { ReachComparisons } from '../components/reach/ReachComparisons';
import { ReachDistribution } from '../components/reach/ReachDistribution';
import { AlgorithmDigestCard } from '../components/reach/AlgorithmDigestCard';
import { PlusBadge } from '../components/reach/PlusBadge';
import { PlanGate } from '../components/PlanGate';
import { ReachTable } from '../components/reach/ReachTable';
import { SuspectPosts } from '../components/reach/SuspectPosts';
import { Callout, Card, EmptyState, FieldGroup, PageHeader, Segmented } from '../components/ui';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXL },
  period: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: tokens.spacingHorizontalM },
  sources: { margin: 0, paddingLeft: tokens.spacingHorizontalL, lineHeight: tokens.lineHeightBase400 },
  loading: { minHeight: '240px' },
  heading: {
    margin: 0,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
});

/** The words of each period, with the plan's badge on the ones that are part of Plus. */
const RANGE_LABEL: Readonly<Record<ReachRange, string>> = { '30d': '30 days', '90d': '90 days', all: 'Everything' };

/**
 * Reach (#429, ADR-0045): how many times X says each of the person's posts and replies was seen, from X's own numbers,
 * each against its usual. The last 30 days are free; longer periods and the comparisons are part of Plus (ADR-0042),
 * each behind `PlanGate`: open as a preview until sales start, then for a plan that includes them. A closed part shows
 * where plans are, and deletes nothing. The numbers come from the views X already showed Xomoni on pages the person opened, and from X's
 * analytics export once the vault reads it. Xomoni never searches X or opens a page to measure reach.
 */
export function ReachPage({ account }: Pick<PageProps, 'account'>) {
  const styles = useStyles();
  const [range, setRange] = useState<ReachRange>('30d');
  const data = useReachData(account.id, range);
  const months = useLiveQuery(async () => await labelMonths(account.id), [account.id]);
  return (
    <>
      <PageHeader
        title="Reach"
        description="How many times X says each of your posts was seen, from X's own numbers, against your usual. It shows what goes together, not why."
      />
      <div className={styles.stack}>
        <div className={styles.period}>
          <FieldGroup label="Period">
            <div className={styles.period}>
              <Segmented
                value={range}
                onChange={setRange}
                options={(['30d', '90d', 'all'] as const).map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
              />
              {PLUS_RANGES.has(range) && <PlusBadge feature="reach-history" />}
            </div>
          </FieldGroup>
        </div>
        {data === undefined ? (
          <div className={styles.loading} aria-busy="true" />
        ) : !data.csv && !data.live ? (
          <Card>
            <EmptyState
              icon={<DataTrending20Regular />}
              title="No reach to show yet"
              body="Reach's numbers come from the views X shows on your own posts and replies. Open your profile on X, and Xomoni keeps the views it shows. More sources are coming."
            />
          </Card>
        ) : (
          <>
            <Sources data={data} />
            {PLUS_RANGES.has(range) ? (
              // Longer than 30 days is part of Plus (#423): the same posts stay in Xomoni either way.
              <PlanGate feature="reach-history">
                <ReachTable rows={data.rows} handle={account.handle} />
                <ReachDistribution rows={data.rows} handle={account.handle} />
              </PlanGate>
            ) : (
              <>
                <ReachTable rows={data.rows} handle={account.handle} />
                <ReachDistribution rows={data.rows} handle={account.handle} />
              </>
            )}
            <section aria-label="Comparisons" className={styles.stack}>
              <div className={styles.period}>
                <h2 className={styles.heading}>Comparisons</h2>
                <PlusBadge feature="reach-compare" />
              </div>
              <PlanGate feature="reach-compare">
                <ReachComparisons rows={data.rows} periods={data.periods} account={account} />
              </PlanGate>
            </section>
            {months && (
              <section aria-label="Suspected posts" className={styles.stack}>
                <div className={styles.period}>
                  <h2 className={styles.heading}>Suspected posts</h2>
                  <PlusBadge feature="reach-suspects" />
                </div>
                <SuspectPosts accountId={account.id} rows={data.rows} months={months} handle={account.handle} />
              </section>
            )}
          </>
        )}
        {months && <LabelHistory months={months} />}
        {/* What changed in X's ranking code (#430, ADR-0046): a link to xomoni.com, nothing fetched. */}
        <AlgorithmDigestCard />
      </div>
    </>
  );
}

/** Where the period's numbers come from, and what they can and can't say. */
function Sources({ data }: { data: ReachData }) {
  const styles = useStyles();
  return (
    <Callout tone="neutral" icon={<Info20Regular />} title="Where these numbers come from">
      <ul className={styles.sources}>
        {data.live > 0 && (
          <li>
            Views Xomoni saw on X: {fmtNumber(data.live)} {data.live === 1 ? 'post' : 'posts'}, as last seen
            {data.lastSeen ? ` ${fmtAgo(data.lastSeen)}` : ''}.
          </li>
        )}
        {data.csv > 0 && (
          <li>
            X&apos;s analytics export: {fmtNumber(data.csv)} {data.csv === 1 ? 'post' : 'posts'}, as of the day it was
            made.
          </li>
        )}
        <li>
          A post&apos;s usual is the median of your posts of the same kind in the 8 weeks before it, and needs 15 of
          them. A post read before it was 7 days old is still growing, and isn&apos;t compared.
        </li>
      </ul>
    </Callout>
  );
}
