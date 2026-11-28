// X's *Under the hood* report on the vault's importer (#428, ADR-0043, ADR-0045): the parser for the JSON the person
// downloads from x.com/i/under_the_hood, registered when this module loads, with the report's monthly reminder
// (`under-the-hood-freshness.ts`). It reads the file with `under-the-hood.ts` and keeps its month with
// `label-months.ts`. Nothing here sends anything anywhere or acts on X.
import { sameHandle } from '../ids';
import { isConfirmed } from './db';
import { type OwnerVerdict, type VaultBatch, type VaultFile, type VaultParser, registerParser } from './importer';
import { saveLabelMonth } from './label-months';
import './under-the-hood-freshness';
import {
  type LabelChange,
  UNDER_THE_HOOD_MAX_BYTES,
  UNDER_THE_HOOD_PROBLEMS,
  type UnderTheHoodResult,
  parseUnderTheHoodText,
} from './under-the-hood';

/** What hears of the labels a report brought, new or larger than the month before: the Vault page's notification. */
export type LabelChangeListener = (
  account: { id: string; handle: string },
  month: string,
  changes: readonly LabelChange[],
) => Promise<unknown>;

let labelChangeListener: LabelChangeListener | null = null;

/**
 * Sets what hears of the labels each imported report brings (#430): the Vault page notifies the person once per month
 * (`alertLabelChanges`); null stops it. A listener's failure fails nothing but its own notice.
 */
export function onLabelChanges(listener: LabelChangeListener | null): void {
  labelChangeListener = listener
    ? async (...args) => {
        try {
          return await listener(...args);
        } catch {
          return null;
        }
      }
    : null;
}

/** What was read of each file the parser takes, so a file is read once while an import is planned and run. */
const readResults = new WeakMap<VaultFile, UnderTheHoodResult>();

async function readFile(file: VaultFile, now: number): Promise<UnderTheHoodResult> {
  const known = readResults.get(file);
  if (known) return known;
  const result = parseUnderTheHoodText(await file.text(), now);
  readResults.set(file, result);
  return result;
}

/** A JSON file by its name. */
const isJson = (file: VaultFile) => file.name.toLowerCase().endsWith('.json');

/**
 * X's *Under the hood* report on the vault's importer (`x-under-the-hood`): a `.json` file the person dropped on its own
 * (never one inside a ZIP, such as an archive's), one part per file, 5 MB at most. A JSON that isn't X's report is
 * refused with *This isn’t X’s Under the hood file*; one that names another account is refused; one that names none is
 * confirmed by the person, once for that file. Reading it keeps its month (`saveLabelMonth`), replacing an earlier
 * file's for that month, and notes the labels that are new or larger on the timeline. The same file again is a
 * duplicate, by its fingerprint.
 */
export const UNDER_THE_HOOD_PARSER: VaultParser = {
  source: 'x-under-the-hood',
  label: 'X’s Under the hood report',
  version: 1,
  onePerFile: true,

  matches(files) {
    return files.filter((file) => isJson(file) && !file.zip);
  },

  maxBytes() {
    return UNDER_THE_HOOD_MAX_BYTES;
  },

  tooBig() {
    return UNDER_THE_HOOD_PROBLEMS['too-large'];
  },

  async owner(files, account, print): Promise<OwnerVerdict> {
    const [file] = files;
    if (!file) return { ok: false, reason: UNDER_THE_HOOD_PROBLEMS['not-under-the-hood'] };
    const result = await readFile(file, Date.now());
    if (!result.ok) return { ok: false, reason: result.message };
    const { owner } = result;
    if (!owner) {
      if (await isConfirmed(account.id, print)) return { ok: true };
      return { ok: 'confirm', question: `Is this Under the hood report from @${account.handle}?` };
    }
    const theirs =
      (owner.accountId !== undefined && owner.accountId !== account.id) ||
      (owner.handle !== undefined && account.handle !== '' && !sameHandle(owner.handle, account.handle));
    return theirs
      ? {
          ok: false,
          reason: `This Under the hood report is another account’s, not @${account.handle}’s. Nothing was imported.`,
        }
      : { ok: true };
  },

  async *read(files, ctx): AsyncIterable<VaultBatch> {
    for (const file of files) {
      if (ctx.signal?.aborted) return;
      const result = await readFile(file, ctx.now);
      if (!result.ok) {
        ctx.problem(result.problem);
        yield { read: 0, skipped: 1, write: () => Promise.resolve(0) };
        continue;
      }
      const { month, unknownFields, skipped } = result;
      for (const name of unknownFields) ctx.problem(`unknown-field:${name}`);
      const [year, m] = month.month.split('-').map(Number) as [number, number];
      ctx.cover(Date.UTC(year, m - 1, 1), Date.UTC(year, m, 1) - 1);
      ctx.count('labels', month.labels.length);
      ctx.progress(`Reading ${file.name}`);
      yield {
        read: 1,
        skipped,
        write: async () => {
          const changes = await saveLabelMonth(ctx.account.id, month, ctx.now, ctx.now);
          if (changes.length) await labelChangeListener?.(ctx.account, month.month, changes);
          return 1;
        },
      };
    }
  },
};

registerParser(UNDER_THE_HOOD_PARSER);
