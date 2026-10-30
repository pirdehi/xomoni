import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileJson,
  FolderOpen,
  Heart,
  History,
  LoaderCircle,
  MessageSquareReply,
  Search,
  SquarePen,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createScanJob } from '../../engine/runner';
import { db } from '../../shared/db';
import type { ItemKind, ScanTarget } from '../../shared/types';
import type { PageProps } from '../navigation';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, Segmented } from '../components/ui';
import { KIND_PLURAL, downloadFile, fmtDate, fmtNumber, postUrl, toDateInput } from '../format';
import { startJob, toast, useRunner } from '../hooks';
import { importArchive } from '../importArchive';
import { useKindCounts } from '../queries';

const PAGE_SIZE = 25;

/**
 * The local inventory: X archive import, scan jobs that only read X, and a paged browser of known
 * items with JSON export. Nothing on this page changes anything on X.
 */
export function InventoryPage({ account, navigate }: PageProps) {
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Everything Xomoni knows about your account. Fill it from your official X archive (complete) and/or by scanning X (recent)."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ImportCard account={account} />
        <ScanCard accountId={account.id} navigate={navigate} />
      </div>
      <div className="mt-4">
        <Browser accountId={account.id} handle={account.handle} />
      </div>
    </>
  );
}

function ImportCard({ account }: Pick<PageProps, 'account'>) {
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const run = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setBusy('Starting…');
    try {
      const r = await importArchive([...list], account, setBusy);
      toast(`Imported ${fmtNumber(r.tweets)} posts and ${fmtNumber(r.likes)} likes`, 'good');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (folderInput.current) folderInput.current.value = '';
      if (filesInput.current) filesInput.current.value = '';
    }
  };

  return (
    <Card
      title="Import your X archive"
      subtitle="The only complete list of your posts and likes — including ones X no longer shows."
    >
      <ol className="mb-4 list-decimal space-y-1 pl-4 text-xs text-ink-2">
        <li>
          On X: <span className="text-ink">Settings → Your account → Download an archive of your data</span> (ready in
          24–72h).
        </li>
        <li>
          Unzip it, then choose its <span className="font-mono text-ink">data</span> folder below.
        </li>
      </ol>
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-axis bg-surface-2 px-4 py-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void run(e.dataTransfer.files);
        }}
      >
        {busy ? (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <LoaderCircle size={15} className="animate-spin" /> {busy}
          </div>
        ) : (
          <>
            <Archive size={20} className="mb-2 text-muted" />
            <p className="text-sm text-ink">Drop account.js, tweets.js and like.js here</p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<FolderOpen size={13} />}
                onClick={() => folderInput.current?.click()}
              >
                Choose data folder
              </Button>
              <Button size="sm" icon={<FileJson size={13} />} onClick={() => filesInput.current?.click()}>
                Choose files
              </Button>
            </div>
          </>
        )}
      </div>
      <input ref={folderInput} type="file" multiple hidden onChange={(e) => void run(e.target.files)} />
      <input ref={filesInput} type="file" multiple accept=".js" hidden onChange={(e) => void run(e.target.files)} />
      {error && (
        <div className="mt-3">
          <Callout tone="critical" icon={<Archive size={14} />}>
            {error}
          </Callout>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">
        Files are read locally. Only account.js, tweets.js and like.js are opened.
      </p>
    </Card>
  );
}

const SCANS: { target: ScanTarget; title: string; body: string; icon: ReactNode }[] = [
  {
    target: 'posts',
    title: 'Posts & reposts',
    body: 'Your profile timeline (about the latest 3,200).',
    icon: <SquarePen size={15} />,
  },
  { target: 'replies', title: 'Replies', body: 'Your replies timeline.', icon: <MessageSquareReply size={15} /> },
  { target: 'likes', title: 'Likes', body: 'Your Likes page (recent likes).', icon: <Heart size={15} /> },
  {
    target: 'history',
    title: 'Full history',
    body: 'Searches X half-year by half-year back to when you joined.',
    icon: <History size={15} />,
  },
];

function ScanCard({ accountId, navigate }: { accountId: string; navigate: PageProps['navigate'] }) {
  const run = useRunner();
  const scan = async (target: ScanTarget, title: string) => {
    const job = await createScanJob(accountId, `Scan: ${title}`, target);
    startJob(job.id);
    navigate('jobs');
  };
  return (
    <Card
      title="Scan from X"
      subtitle="Scrolls pages of X in the worker window and records what it sees. Nothing is changed."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SCANS.map((s) => (
          <button
            key={s.target}
            type="button"
            disabled={run.status !== 'idle'}
            onClick={() => void scan(s.target, s.title)}
            className="flex items-start gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="mt-0.5 text-accent">{s.icon}</span>
            <span>
              <span className="block text-sm font-medium text-ink">{s.title}</span>
              <span className="block text-xs text-ink-2">{s.body}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Tip: Xomoni also records your own posts whenever you browse your profile in the worker window.
      </p>
    </Card>
  );
}

function Browser({ accountId, handle }: { accountId: string; handle: string }) {
  const [kind, setKind] = useState<ItemKind>('post');
  const [status, setStatus] = useState<'present' | 'deleted'>('present');
  const [query, setQuery] = useState('');
  // The page number belongs to one filter; changing the kind, status or search starts again at page 1.
  const filterKey = `${kind}|${status}|${query}`;
  const [paging, setPaging] = useState({ filterKey, page: 0 });
  const page = paging.filterKey === filterKey ? paging.page : 0;
  const setPage = (next: number) => setPaging({ filterKey, page: next });
  const counts = useKindCounts(accountId);
  const total = counts?.[kind][status] ?? 0;

  const rows = useLiveQuery(() => {
    let coll = db.items
      .where('[accountId+kind+status+createdAt]')
      .between([accountId, kind, status, -Infinity], [accountId, kind, status, Infinity])
      .reverse();
    const q = query.trim().toLowerCase();
    if (q) coll = coll.filter((i) => i.text.toLowerCase().includes(q) || i.author.toLowerCase().includes(q));
    return coll
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray();
  }, [accountId, kind, status, query, page]);

  const exportAll = async () => {
    const all = await db.items
      .where('[accountId+kind+status+createdAt]')
      .between([accountId, kind, status, -Infinity], [accountId, kind, status, Infinity])
      .toArray();
    downloadFile(`xomoni-${kind}s-${status}-${toDateInput(Date.now())}.json`, JSON.stringify(all, null, 2));
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Card
      title="Browse"
      padded={false}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<Download size={13} />}
          onClick={() => void exportAll()}
          disabled={!total}
        >
          Export JSON
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
        <Segmented
          value={kind}
          onChange={setKind}
          options={(['post', 'reply', 'repost', 'like'] as ItemKind[]).map((k) => ({
            value: k,
            label: `${KIND_PLURAL[k]} ${counts ? fmtNumber(counts[k][status]) : ''}`,
          }))}
        />
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'present', label: 'On X' },
            { value: 'deleted', label: 'Removed' },
          ]}
        />
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            className="field pl-8"
            placeholder="Search text or @author"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {rows && !rows.length ? (
        <EmptyState
          icon={<Archive size={18} />}
          title="Nothing here"
          body={query ? 'No items match your search.' : 'Import your archive or run a scan to fill the inventory.'}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Text</th>
                <th className="py-2 text-right font-medium">Likes</th>
                <th className="py-2 pl-4 font-medium">Source</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows?.map((item) => (
                <tr key={item.key} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <td className="tabular px-5 py-2.5 align-top whitespace-nowrap text-xs text-ink-2">
                    {fmtDate(item.kind === 'like' ? (item.likedAt ?? item.createdAt) : item.createdAt)}
                    {item.kind === 'like' && item.likedAt && <div className="text-[10px] text-muted">liked (est.)</div>}
                  </td>
                  <td className="max-w-xl py-2.5 align-top">
                    {item.author && item.author.toLowerCase() !== handle.toLowerCase() && (
                      <span className="text-xs text-muted">@{item.author} · </span>
                    )}
                    <span className="line-clamp-2 text-ink">
                      {item.text || <span className="text-muted">(no text recorded)</span>}
                    </span>
                  </td>
                  <td className="tabular py-2.5 text-right align-top text-xs text-ink-2">
                    {item.kind === 'like' ? '—' : fmtNumber(item.likes)}
                  </td>
                  <td className="py-2.5 pl-4 align-top">
                    <div className="flex gap-1">
                      {item.sources.map((s) => (
                        <Badge key={s} tone={s === 'archive' ? 'neutral' : 'accent'}>
                          {s === 'archive' ? 'Archive' : 'Scan'}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right align-top">
                    <a
                      href={postUrl(
                        item.kind === 'repost' ? item.targetId || item.id : item.id,
                        item.kind === 'post' || item.kind === 'reply' ? handle : undefined,
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted hover:text-accent"
                      title="Open on X"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-ink-2">
        <span className="tabular">
          {query ? 'Filtered' : `${fmtNumber(total)} items`} · page {page + 1}
          {!query && ` of ${fmtNumber(pages)}`}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<ChevronLeft size={14} />}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={(rows?.length ?? 0) < PAGE_SIZE || (!query && page + 1 >= pages)}
            onClick={() => setPage(page + 1)}
          >
            Next <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </Card>
  );
}
