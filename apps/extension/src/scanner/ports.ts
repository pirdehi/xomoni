// The scanner's ports (#491, ADR-0049): what a scan needs from the platform, as interfaces. The scanner's core
// (text, rules, detectors, the worker and its controller) depends on these, never on `chrome.*`, `fetch` or a model
// runtime. The adapters (Chrome's built-in AI, transformers.js, WebLLM, the model pack store, the database) are wired
// in `platform.ts`. Interfaces only: there is nothing here to test.

/** Whether a model runner can answer on this computer now, after a download the person asks for, or not at all. */
export type ModelAvailability = 'ready' | 'needs-download' | 'unavailable';

/** One request to a model: the same task over a batch of texts, each answer shaped by `schema` (ADR-0050). */
export interface ModelRequest {
  /** The detector's task, such as `classify-sensitive`. */
  readonly task: string;
  /** The texts to read, at most one batch; never sent anywhere off the computer. */
  readonly texts: readonly string[];
  /** The JSON schema each answer must match; an answer that doesn't is dropped. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** Stops the request when the scan is cancelled. */
  readonly signal?: AbortSignal;
}

/**
 * A model's answers, one per text, in order. They are untrusted data (ADR-0050): the caller checks each against the
 * request's schema and caps its length before it becomes a reason, and never acts on one.
 */
export interface ModelAnswer {
  /** The runner that answered, such as `chrome-ai` or `fake`. */
  readonly runner: string;
  /** One raw answer per text, `null` where the model gave none: unchecked until the caller checks it. */
  readonly answers: readonly unknown[];
}

/** A model on the computer: Chrome's built-in one, a bundled WebAssembly runtime, or the fake one in e2e builds. */
export interface ModelRunner {
  /** A stable id, such as `chrome-ai`, `transformers`, `webllm` or `fake`. */
  readonly id: string;
  /** Whether it can answer, without downloading anything. */
  availability(): Promise<ModelAvailability>;
  /** Answers a batch. Throws when cancelled (`AbortError`) or when the runtime fails; it never retries by itself. */
  run(request: ModelRequest): Promise<ModelAnswer>;
}

/** A post or like as the scanner reads it: the Library's item, with the archive's extra fields when known. */
export interface ScanItem {
  /** The Library's item key. */
  readonly key: string;
  /** `post`, `reply`, `repost` or `like`. */
  readonly kind: string;
  /** The text as X gave it. */
  readonly text: string;
  /** When it was posted or liked, epoch ms, or null when unknown. */
  readonly createdAt: number | null;
}

/** A page of items and where the next page starts, or null after the last one. */
export interface ScanPage {
  readonly items: readonly ScanItem[];
  readonly next: string | null;
}

/** What a detector proposes about one item, with the reason it must give (ADR-0049: no reason, no finding). */
export interface FindingProposal {
  /** The item's key. */
  readonly itemKey: string;
  /** The lens that asked, such as `context` or `place`. */
  readonly lens: string;
  /** The lens's category, such as `email-address`. */
  readonly category: string;
  /** From 1 (worth a look) to 4 (likely harmful). */
  readonly severity: 1 | 2 | 3 | 4;
  /** The reason code the review queue words, never empty. */
  readonly reason: string;
  /** The spans of the item's text that show it, as `[start, end)` offsets. */
  readonly spans: readonly (readonly [number, number])[];
  /** The detector's id, so a finding can be traced to the rule or model that made it. */
  readonly detector: string;
}

/**
 * Where a scan reads items and keeps what it found, on the extension's database (CS.1.6). A scan reads one page at a
 * time and saves its findings and cursor together, so a reload resumes where it stopped.
 */
export interface ScanStore {
  /** A page of the account's items after `cursor` (null for the first page), at most `limit` of them. */
  page(accountId: string, cursor: string | null, limit: number): Promise<ScanPage>;
  /** Saves a page's proposals and moves the run's cursor, in one transaction. */
  save(runId: string, proposals: readonly FindingProposal[], cursor: string | null): Promise<void>;
}

/** The time, as a port so tests can set it. */
export interface Clock {
  /** Epoch ms now. */
  now(): number;
}

/** Everything a scan's core receives from `platform.ts`. */
export interface ScannerPorts {
  readonly store: ScanStore;
  readonly clock: Clock;
  /** The runners to try, in ADR-0050's order; empty means rules only. */
  readonly runners: readonly ModelRunner[];
}
