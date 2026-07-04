import { readFileSync } from 'fs';
import path from 'path';
import initSqlJs, { type Database } from 'sql.js';
import { SEED_SQL } from './schema';

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
};

// sql.js is SQLite compiled to WebAssembly. We keep one in-memory database per
// warm serverless instance and seed it once — the data is tiny and every query
// is read-only, so there's nothing to persist.
let dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const file = readFileSync(
        path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
      );
      // sql.js wants an ArrayBuffer; readFileSync hands back a Buffer view.
      const wasmBinary = new ArrayBuffer(file.byteLength);
      new Uint8Array(wasmBinary).set(file);
      const SQL = await initSqlJs({ wasmBinary });
      const db = new SQL.Database();
      db.run(SEED_SQL);
      return db;
    })();
  }
  return dbPromise;
}

// Runs a query and returns columns + rows. Throws if the SQL is invalid or
// references something that isn't in the schema — which is exactly the signal
// the guard wants (see guard.ts).
export async function runQuery(sql: string): Promise<QueryResult> {
  const db = await getDb();
  const stmt = db.prepare(sql);
  try {
    const rows: unknown[][] = [];
    while (stmt.step()) rows.push(stmt.get());
    return { columns: stmt.getColumnNames(), rows };
  } finally {
    stmt.free();
  }
}
