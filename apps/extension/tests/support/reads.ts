// How many rows a piece of code reads from IndexedDB (#390): a Dexie middleware counts each row handed to the code,
// whether by a get, a bulk get, a query or a cursor step, how many cursor steps it took, and how many entries it
// counted on an index. A path that reads every row of a large table where an index or a count would do shows up here
// at any scale, where a timing would only show it at a large one. Keys (`.keys()`) and counts are not rows.
import type { DBCore, DBCoreCursor, DBCoreTable } from 'dexie';
import { db } from '../../src/shared/db';

/** What `countReads` counted, per table. */
export interface Reads {
  /** Rows handed over, values only. */
  rows: Record<string, number>;
  /** Cursor steps, with or without a value: a cursor walks one row at a time, slowly in a real browser. */
  steps: Record<string, number>;
  /**
   * Entries counted on an index (`count()` on an index's range), each checked against its row by a browser: several
   * times as slow as counting on the primary key, which isn't counted here.
   */
  indexCounted: Record<string, number>;
  /** Writes (a put, add or delete of one or many rows): each one the open pages' live queries answer by reading again. */
  writes: Record<string, number>;
}

let counting: Reads | null = null;

const add = (into: Record<string, number>, table: string, n: number) => {
  into[table] = (into[table] ?? 0) + n;
};

/** Wraps a cursor so each step it takes is counted, and each row it hands over when it reads values. */
function countedCursor(cursor: DBCoreCursor, table: string, values: boolean): DBCoreCursor {
  return Object.create(cursor, {
    start: {
      value: (onNext: () => void) =>
        cursor.start(() => {
          if (counting) {
            add(counting.steps, table, 1);
            if (values) add(counting.rows, table, 1);
          }
          onNext();
        }),
    },
  }) as DBCoreCursor;
}

/** The middleware: passes everything through, counting while `countReads` runs. */
function counter(down: DBCore): DBCore {
  return {
    ...down,
    table(name: string): DBCoreTable {
      const table = down.table(name);
      return {
        ...table,
        get: async (req) => {
          const row: unknown = await table.get(req);
          if (counting && row !== undefined) add(counting.rows, name, 1);
          return row;
        },
        getMany: async (req) => {
          const rows: unknown[] = await table.getMany(req);
          if (counting) add(counting.rows, name, rows.filter((r) => r !== undefined).length);
          return rows;
        },
        query: async (req) => {
          const res = await table.query(req);
          if (counting && req.values) add(counting.rows, name, res.result.length);
          return res;
        },
        mutate: async (req) => {
          if (counting) add(counting.writes, name, 1);
          return table.mutate(req);
        },
        count: async (req) => {
          const n = await table.count(req);
          if (counting && !req.query.index.isPrimaryKey) add(counting.indexCounted, name, n);
          return n;
        },
        openCursor: async (req) => {
          const cursor = await table.openCursor(req);
          return cursor && countedCursor(cursor, name, req.values !== false);
        },
      };
    },
  };
}

/**
 * Installs the counter on the extension's database, reopening it if it was open (Dexie builds its middleware stack
 * when it opens). Call once per test file, before counting.
 */
export async function installReadCounter(): Promise<void> {
  const open = db.isOpen();
  if (open) db.close();
  db.use({ stack: 'dbcore', name: 'xomoni-read-counter', create: counter });
  await db.open();
}

/** Runs `fn` and returns what it read, with its result. Not reentrant: one count at a time. */
export async function countReads<T>(fn: () => Promise<T>): Promise<{ result: T; reads: Reads }> {
  counting = { rows: {}, steps: {}, indexCounted: {}, writes: {} };
  try {
    const result = await fn();
    return { result, reads: counting };
  } finally {
    counting = null;
  }
}
