import { CircleCheck, CircleX, ExternalLink, Info, TriangleAlert } from 'lucide-react';
import type { LogEntry } from '../../shared/types';
import { fmtAgo, fmtDateTime, postUrl } from '../format';
import { useNow } from './ui';

const ICON = {
  success: <CircleCheck size={14} className="text-good" />,
  info: <Info size={14} className="text-muted" />,
  warn: <TriangleAlert size={14} className="text-serious" />,
  error: <CircleX size={14} className="text-critical" />,
};

/**
 * Activity log rows: level icon, message, a link to the post on X when the entry names one, and
 * the time (relative, or absolute with `absolute`).
 */
export function LogList({ entries, absolute = false }: { entries: LogEntry[]; absolute?: boolean }) {
  const now = useNow(30_000);
  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => (
        <li key={e.seq} className="flex items-start gap-3 py-2.5 text-sm">
          <span className="mt-0.5 shrink-0">{ICON[e.level]}</span>
          <span className="min-w-0 flex-1 text-ink">
            {e.message}
            {e.targetId && (
              <a
                href={postUrl(e.targetId)}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-0.5 text-xs text-muted hover:text-accent"
                title="Open on X"
              >
                {e.targetId.slice(-6)} <ExternalLink size={10} />
              </a>
            )}
          </span>
          <span className="tabular shrink-0 text-xs text-muted" title={new Date(e.ts).toLocaleString()}>
            {absolute ? fmtDateTime(e.ts) : fmtAgo(e.ts, now)}
          </span>
        </li>
      ))}
    </ul>
  );
}
