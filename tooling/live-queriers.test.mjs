// The extension's live queries keep Dexie's zone (#459), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
// Dexie keeps a live query's zone across awaits only for an async querier: a plain one that returns an async helper's
// promise reads outside it, and uses up the budget the page's other live queries keep their reads with, so a part of
// the dashboard stops following what it shows (#402's S199-18: the account in the X window).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'apps/extension/src');

/** Every .ts and .tsx file under `dir`. */
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The first argument of each `useLiveQuery(` call in `text`, up to its top-level comma or closing parenthesis. */
function queriers(text) {
  const found = [];
  const open = 'useLiveQuery(';
  for (let at = text.indexOf(open); at >= 0; at = text.indexOf(open, at + 1)) {
    let depth = 0;
    let end = at + open.length;
    for (; end < text.length; end++) {
      const c = text[end];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
    }
    found.push(text.slice(at + open.length, end).trim());
  }
  return found;
}

/** Whether `querier` keeps Dexie's zone: an async function, a reference to one, or a plain arrow returning `db.…`. */
function keepsZone(querier) {
  if (/^async\b/.test(querier)) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(querier)) return true;
  const arrow = /^\(([^)]*)\)\s*=>\s*([\s\S]*)$/.exec(querier);
  if (!arrow) return false;
  const body = arrow[2].trim();
  return /^db\.\w+\.[\w$]+\(/.test(body) && !/\bawait\b|\)\s*\.then\(/.test(body);
}

const files = sources(SRC).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

describe('live queries keep Dexie’s zone (#459)', () => {
  it('tells the patterns apart', () => {
    assert.equal(keepsZone('async () => await watchBadgeCount(accountId)'), true);
    assert.equal(keepsZone('getSettings'), true);
    assert.equal(keepsZone('() => db.jobs.get(jobId)'), true);
    assert.equal(keepsZone('() => (state.jobId ? db.jobs.get(state.jobId) : undefined)'), false);
    assert.equal(keepsZone('() => pendingStop()'), false);
    assert.equal(keepsZone('() => (hasStore ? storeMoveWanted() : false)'), false);
    assert.deepEqual(queriers('useLiveQuery(() => f(a, b), [a]); useLiveQuery(g)'), ['() => f(a, b)', 'g']);
  });

  it('has no plain querier that returns an async helper’s promise, anywhere in the extension', () => {
    const offending = files.flatMap(({ file, text }) =>
      queriers(text)
        .filter((q) => !keepsZone(q))
        .map((q) => `${relative(SRC, file)}: ${q.split('\n')[0]}`),
    );
    assert.deepEqual(offending, []);
  });

  it('passes only async functions by reference', () => {
    const text = files.map((f) => f.text).join('\n');
    const references = files.flatMap((f) => queriers(f.text)).filter((q) => /^[A-Za-z_$][\w$]*$/.test(q));
    for (const name of new Set(references))
      assert.ok(new RegExp(`async function ${name}\\b|const ${name} = async\\b`).test(text), `${name} is async`);
  });
});
