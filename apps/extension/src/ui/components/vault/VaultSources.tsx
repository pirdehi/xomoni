import { Body1, Caption1, makeStyles, tokens } from '@fluentui/react-components';
import { Vault24Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../shared/db';
import { importLedger } from '../../../shared/vault/db';
import { type Freshness, freshnessOf, freshnessSources } from '../../../shared/vault/freshness';
import type { VaultImport } from '../../../shared/vault/types';
import { ARCHIVE_PAGE_URL } from '../../../shared/x-archive';
import type { Account } from '../../../shared/types';
import { fmtDate } from '../../format';
import type { PageId } from '../../navigation';
import { Badge, Button, Card, EmptyState, type Tone, useNow } from '../ui';

const useStyles = makeStyles({
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: tokens.spacingVerticalM },
  source: { display: 'grid', gap: tokens.spacingVerticalXXS },
  head: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, alignItems: 'center' },
  muted: { color: tokens.colorNeutralForeground3 },
  start: { display: 'grid', gap: tokens.spacingVerticalS, justifyItems: 'center' },
});

/** Each freshness in the person's words, with its badge's tone. */
export const FRESHNESS_WORDS: Record<Freshness, { label: string; tone: Tone }> = {
  never: { label: 'Not yet', tone: 'neutral' },
  fresh: { label: 'Up to date', tone: 'good' },
  due: { label: 'Due for a new copy', tone: 'warn' },
  overdue: { label: 'Overdue', tone: 'serious' },
};

/** What the vault holds of each of X's files, for the sources card. */
export interface SourceSummary {
  source: string;
  label: string;
  freshness: Freshness;
  lastAt: number | null;
  /** The newest import read in whole. */
  last: VaultImport | null;
}

/** What the sources card shows: each followed source, and what the analytics hold. */
export interface VaultHoldings {
  sources: SourceSummary[];
  posts: number;
  days: number;
  firstDay: string | null;
  lastDay: string | null;
}

/** Reads what the account's vault holds, for the sources card; only through the database's indexes. */
export async function vaultHoldings(accountId: string, now: number): Promise<VaultHoldings> {
  const ledger = (await importLedger(accountId)).filter(
    (r) => !r.problems.some((p) => p === 'duplicate' || p === 'cancelled' || p === 'failed'),
  );
  const sources: SourceSummary[] = [];
  for (const source of freshnessSources()) {
    const lastAt = await source.lastAt(accountId);
    const last =
      ledger.find(
        (r) => r.source === source.source || (source.source === 'x-analytics-posts' && r.source === 'x-analytics-days'),
      ) ?? null;
    sources.push({
      source: source.source,
      label: source.label,
      freshness: freshnessOf(lastAt, source.cadenceDays, source.graceDays, now),
      lastAt,
      last,
    });
  }
  const range = db.analyticsDays.where('[accountId+day]').between([accountId, ''], [accountId, '￿']);
  return {
    sources,
    posts: await db.analyticsPosts.where('accountId').equals(accountId).count(),
    days: await range.count(),
    firstDay: (await range.first())?.day ?? null,
    lastDay: (await range.last())?.day ?? null,
  };
}

const ageOf = (at: number, now: number) => {
  const days = Math.floor((now - at) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? '1 day old' : `${days.toLocaleString('en')} days old`;
};

/**
 * *Your sources* on the Vault page (#425): each of X's files the vault follows, how fresh it is, and what it holds:
 * X's archive with the day X made it and its posts and likes, X's analytics with the posts and days it covers. With
 * nothing in the vault, how to start: open X's archive or analytics page yourself, or get the archive in the Library,
 * then drop the files here. Xomoni never opens X for this.
 */
export function VaultSources({ account, navigate }: { account: Account; navigate: (page: PageId) => void }) {
  const styles = useStyles();
  // The page counts ages from the minute it shows, and again each minute.
  const now = useNow(60_000);
  // Async, so Dexie's zone holds across the helper's awaits (#459).
  const holdings = useLiveQuery(async () => await vaultHoldings(account.id, now), [account.id, now]);
  if (!holdings) return <Card title="Your sources" />;
  const empty = holdings.sources.every((s) => s.freshness === 'never') && !holdings.posts && !holdings.days;

  return (
    <Card title="Your sources" subtitle="X’s files in your vault, and how fresh each one is.">
      {empty ? (
        <EmptyState
          icon={<Vault24Regular />}
          title="Your vault is empty"
          body={
            <span className={styles.start}>
              <span>
                Get your files from X yourself: your archive from X’s archive page (it takes X a day or more), and your
                analytics from X’s Analytics page. Then drop them on this page.
              </span>
              <span>
                <a href={ARCHIVE_PAGE_URL} target="_blank" rel="noreferrer">
                  Open X’s archive page
                </a>
                {' · '}
                <a href="https://x.com/i/account_analytics" target="_blank" rel="noreferrer">
                  Open X’s Analytics
                </a>
              </span>
            </span>
          }
          action={<Button onClick={() => navigate('library')}>Get my archive in the Library</Button>}
        />
      ) : (
        <ul className={styles.list} aria-label="Your sources">
          {holdings.sources.map((s) => {
            const words = FRESHNESS_WORDS[s.freshness];
            const parts = s.last?.counts.parts;
            return (
              <li key={s.source} className={styles.source}>
                <span className={styles.head}>
                  <Body1>
                    <strong>{s.label}</strong>
                  </Body1>
                  <Badge tone={words.tone}>{words.label}</Badge>
                </span>
                {s.lastAt === null ? (
                  <Caption1 className={styles.muted}>Not imported yet.</Caption1>
                ) : s.source === 'x-archive' ? (
                  <Caption1>
                    Made by X on {fmtDate(s.lastAt)}, {ageOf(s.lastAt, now)}
                    {parts &&
                      ` · ${(parts.tweets ?? 0).toLocaleString('en')} posts, replies and reposts · ${(parts.likes ?? 0).toLocaleString('en')} likes`}
                  </Caption1>
                ) : (
                  <Caption1>
                    Imported {fmtDate(s.lastAt)}, {ageOf(s.lastAt, now)} · {holdings.posts.toLocaleString('en')} posts
                    {holdings.firstDay &&
                      ` · ${holdings.days.toLocaleString('en')} days, ${fmtDate(Date.parse(`${holdings.firstDay}T12:00:00Z`))} to ${fmtDate(Date.parse(`${holdings.lastDay ?? holdings.firstDay}T12:00:00Z`))}`}
                  </Caption1>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!empty && (
        <Button variant="ghost" size="sm" onClick={() => navigate('library')}>
          X’s archive in the Library
        </Button>
      )}
    </Card>
  );
}
