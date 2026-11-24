import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDigest } from '../domain/parse';
import { DIGEST_FILES } from './index';

/** The digest files in this folder, by name, oldest month first. */
const folder = new URL('.', import.meta.url);
const files = readdirSync(folder)
  .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
  .sort();

describe('the digests in the repository (#430, ADR-0046)', () => {
  it('lists every file of the folder in the index, oldest first, as the tool writes it', () => {
    expect(DIGEST_FILES).toHaveLength(files.length);
    const index = readFileSync(new URL('index.ts', folder), 'utf8');
    for (const name of files) expect(index).toContain(`from './${name}';`);
    expect(DIGEST_FILES.map((file) => (file as { month?: unknown }).month)).toEqual(
      files.map((name) => name.replace(/\.json$/, '')),
    );
  });

  it('holds only digests, each in the file of its month', () => {
    for (const [i, file] of DIGEST_FILES.entries()) {
      const read = parseDigest(file);
      expect(read.ok ? [] : read.problems, files[i]).toEqual([]);
      if (read.ok) expect(`${read.digest.month}.json`).toBe(files[i]);
    }
  });
});
