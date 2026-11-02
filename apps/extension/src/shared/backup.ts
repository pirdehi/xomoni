// The archive a person downloads for a date range: their posts, replies and reposts from the inventory, as a
// readable HTML page and as JSON. Built in the dashboard and saved to the person's own computer; nothing is
// sent anywhere (ADR-0004). Text and links only: the inventory keeps no images or videos.
import type { Account, DateRange, Item, ItemKind } from './types';

/** The kinds an archive can hold: the account's own posts, replies and reposts. Likes are not part of it. */
export type ArchiveKind = Extract<ItemKind, 'post' | 'reply' | 'repost'>;

/** Every archive kind, in the order the archive lists their counts. */
export const ARCHIVE_KINDS: readonly ArchiveKind[] = ['post', 'reply', 'repost'];

/** Version of the JSON format; raise it when a field changes meaning. */
export const ARCHIVE_FORMAT_VERSION = 1;

/**
 * The account's items of `kinds` created inside `range`, oldest first. Items Xomoni already deleted stay in,
 * marked as such: an archive is a record of what was posted, kept before or after a cleanup.
 */
export function archiveItems(items: readonly Item[], range: DateRange, kinds: readonly ArchiveKind[]): Item[] {
  return items
    .filter(
      (i) =>
        (kinds as readonly ItemKind[]).includes(i.kind) && i.createdAt >= range.after && i.createdAt < range.before,
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Link to an item on x.com: the post itself, or for a repost the original post. */
export function itemUrl(item: Pick<Item, 'kind' | 'id' | 'targetId' | 'author'>): string {
  const id = item.kind === 'repost' ? item.targetId || item.id : item.id;
  return item.author ? `https://x.com/${item.author}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

/** The archive as JSON: the account, the range, counts per kind and one entry per item. */
export function archiveJson(
  account: Pick<Account, 'id' | 'handle' | 'name'>,
  range: DateRange,
  items: readonly Item[],
) {
  const counts = Object.fromEntries(ARCHIVE_KINDS.map((k) => [k, items.filter((i) => i.kind === k).length]));
  return JSON.stringify(
    {
      format: 'xomoni-archive',
      version: ARCHIVE_FORMAT_VERSION,
      account: { id: account.id, handle: account.handle, name: account.name },
      range: { from: new Date(range.after).toISOString(), until: new Date(range.before).toISOString() },
      createdAt: new Date().toISOString(),
      counts,
      items: items.map((i) => ({
        id: i.id,
        kind: i.kind,
        createdAt: new Date(i.createdAt).toISOString(),
        url: itemUrl(i),
        author: i.author,
        text: i.text,
        inReplyToId: i.inReplyToId,
        likes: i.likes,
        reposts: i.reposts,
        replies: i.replies,
        status: i.status,
      })),
    },
    null,
    2,
  );
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe to place in HTML: every markup character is escaped, so a post can never add markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const KIND_LABEL: Record<ArchiveKind, string> = { post: 'Post', reply: 'Reply', repost: 'Repost' };
const KIND_COUNT: Record<ArchiveKind, string> = { post: 'posts', reply: 'replies', repost: 'reposts' };
const num = (n: number) => n.toLocaleString('en');
const STATUS_NOTE: Record<Item['status'], string> = {
  present: '',
  deleted: 'Deleted by Xomoni',
  gone: 'No longer on X',
};

/**
 * The archive as one self-contained HTML page to open in any browser: no scripts, no outside files, every
 * post's text escaped. Grouped by month, oldest first. `dateLabel` formats a time for headings and entries.
 */
export function archiveHtml(
  account: Pick<Account, 'handle' | 'name'>,
  range: DateRange,
  items: readonly Item[],
  dateLabel: (ms: number) => string = (ms) => new Date(ms).toISOString().slice(0, 10),
): string {
  const months = new Map<string, Item[]>();
  for (const item of items) {
    const d = new Date(item.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const list = months.get(key);
    if (list) list.push(item);
    else months.set(key, [item]);
  }
  const counts = ARCHIVE_KINDS.map((k) => {
    const n = items.filter((i) => i.kind === k).length;
    return `${num(n)} ${n === 1 ? KIND_LABEL[k].toLowerCase() : KIND_COUNT[k]}`;
  });
  const entry = (i: Item) => {
    const note = STATUS_NOTE[i.status];
    const author = i.kind === 'repost' && i.author ? ` of @${escapeHtml(i.author)}` : '';
    return `<article>
<p class="meta"><span class="kind">${KIND_LABEL[i.kind as ArchiveKind]}${author}</span> · <time datetime="${new Date(i.createdAt).toISOString()}">${escapeHtml(dateLabel(i.createdAt))}</time>${note ? ` · <span class="note">${note}</span>` : ''}</p>
<p class="text">${escapeHtml(i.text).replace(/\n/g, '<br>') || '<em>(no text)</em>'}</p>
<p class="meta">${num(i.likes)} likes · ${num(i.reposts)} reposts · ${num(i.replies)} replies · <a href="${escapeHtml(itemUrl(i))}">View on X</a></p>
</article>`;
  };
  const sections = [...months.entries()]
    .map(([month, list]) => `<section>\n<h2>${month}</h2>\n${list.map(entry).join('\n')}\n</section>`)
    .join('\n');
  const title = `Archive of @${escapeHtml(account.handle)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;color:#1d1d1f;background:#fafafa}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:32px 0 8px;color:#555}
article{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:12px 14px;margin:8px 0}
.meta{font-size:12px;color:#6b6b6b;margin:0}.text{margin:6px 0;white-space:normal;overflow-wrap:anywhere}
.kind{font-weight:600;color:#333}.note{color:#b42318}.intro{color:#555;font-size:13px}a{color:#1d4ed8}
</style>
</head>
<body>
<h1>${title}</h1>
<p class="intro">${escapeHtml(account.name)} · ${escapeHtml(dateLabel(range.after))} to ${escapeHtml(dateLabel(range.before - 1))} · ${counts.join(', ')}</p>
<p class="intro">Made by Xomoni from what X showed and your imported X archive. Text and links only: images and videos are not included. Your official X archive is the complete copy.</p>
${sections || '<p>No posts in this range.</p>'}
</body>
</html>
`;
}
