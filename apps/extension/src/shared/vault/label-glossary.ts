// What X's *Under the hood* labels mean (#428, ADR-0045, point 5): only labels whose meaning a public source states,
// each with that source and the day Xomoni last checked it. A label not here is shown with X's own name and no meaning:
// Xomoni never guesses one. Pure.

/** One known label: its meaning in plain words, where that comes from, and when it was last checked. */
export interface GlossaryEntry {
  /** X's name for the label, as its file writes it. */
  name: string;
  /** What the label is, in plain words. */
  meaning: string;
  /** What it does to a post or the account, as the source says. */
  effect: string;
  /** The public page that says so; always `https`. */
  source: string;
  /** The source's name and date, as shown beside the meaning. */
  sourceName: string;
  /** The day Xomoni last checked the source, `yyyy-mm-dd`. */
  checkedOn: string;
}

/**
 * The known labels. Add one only with a public source that states its meaning, and change `checkedOn` whenever the
 * source is checked again; `label-glossary.test.ts` refuses an entry without an `https` source and a real date.
 */
export const LABEL_GLOSSARY: readonly GlossaryEntry[] = [
  {
    name: 'SPAM_HIGH_RECALL',
    meaning: "X's automated systems found that the post may contain spam.",
    effect: "The post isn't recommended to people who don't follow you.",
    source: 'https://roboin.io/article/en/2026/09/04/checking-xs-official-shadowban-checker-under-the-hood/',
    sourceName: 'Roboin, 4 September 2026',
    checkedOn: '2026-11-24',
  },
];

const BY_NAME: ReadonlyMap<string, GlossaryEntry> = new Map(LABEL_GLOSSARY.map((e) => [e.name.toUpperCase(), e]));

/** The glossary's entry for X's label `name`, whatever its case; null for a label Xomoni doesn't know. */
export function glossaryEntry(name: string): GlossaryEntry | null {
  return BY_NAME.get(name.trim().toUpperCase()) ?? null;
}
