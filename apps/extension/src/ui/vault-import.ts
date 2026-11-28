import { CORE_PARSERS } from '../shared/vault/parsers';
import {
  type ImportPlan,
  type PartResult,
  type PlannedPart,
  openFiles,
  planImport,
  registeredParsers,
  runImport,
} from '../shared/vault/importer';
import type { Account } from '../shared/types';

// What the Vault page does with files the person drops or chooses (#425, ADR-0043): plan them on the vault's importer
// with every registered parser, show the plan, and import only the parts the person confirmed. Nothing is read before
// the plan has checked every size, nothing is written before the person presses Import, and nothing leaves the
// computer.

/** The kinds of file the Vault page takes: a ZIP, a CSV or a JSON. */
export const VAULT_ACCEPT = '.zip,.csv,.json,application/zip,text/csv,application/json';

/**
 * The plan for what the person dropped or chose, for `account`: each part with its parser, a duplicate known, the
 * question for files that can't say whose they are; and what was refused, with why. Writes nothing. Throws a ZIP's
 * `ZipError` (a damaged ZIP) with its words.
 */
export async function planVaultImport(
  chosen: readonly File[],
  account: Pick<Account, 'id' | 'handle'>,
): Promise<ImportPlan> {
  // The core's parsers first, in their order; a feature's after them.
  const parsers = [...CORE_PARSERS, ...registeredParsers().filter((p) => !CORE_PARSERS.includes(p))];
  return planImport(await openFiles(chosen), { id: account.id, handle: account.handle }, parsers);
}

/** The parts the person can import now: every part but one that asks whose it is and wasn't confirmed. */
export function partsToImport(plan: ImportPlan, confirmed: ReadonlySet<PlannedPart>): PlannedPart[] {
  return plan.parts.filter((part) => !part.confirm || confirmed.has(part));
}

/**
 * Imports the parts of `plan` the person may import (`partsToImport`), one after the other, with progress and a way to
 * stop between batches. Answers what each part did.
 */
export function runVaultImport(
  plan: ImportPlan,
  confirmed: ReadonlySet<PlannedPart>,
  options: { onProgress?: (message: string) => void; signal?: AbortSignal } = {},
): Promise<PartResult[]> {
  return runImport({ ...plan, parts: partsToImport(plan, confirmed) }, options);
}

/** One part's result, in the person's words: what it added, or why it added nothing. */
export function describeResult(result: PartResult): string {
  const { counts } = result;
  const label = result.part.parser.label;
  if (result.duplicate) return `${label}: already imported, nothing new.`;
  if (result.cancelled) return `${label}: stopped. ${counts.merged.toLocaleString('en')} rows were kept.`;
  const skipped = counts.skipped ? `, ${counts.skipped.toLocaleString('en')} skipped` : '';
  return `${label}: ${counts.merged.toLocaleString('en')} rows imported${skipped}.`;
}
