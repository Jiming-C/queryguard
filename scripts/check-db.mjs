// Quick sanity check for the parts that don't need an API key: the seed loads,
// a real query runs, and the read-only guard rejects a write. Run with `npm run check`.
import { readFileSync } from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';

// Pull the seed straight out of the source so this stays in sync with the app.
const schemaSrc = readFileSync(path.join(process.cwd(), 'lib/schema.ts'), 'utf8');
const seed = schemaSrc.match(/export const SEED_SQL = `([\s\S]*?)`;/)[1];

const MUTATING = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i;
const isReadOnly = (sql) => !/;\s*\S/.test(sql.trim()) && !MUTATING.test(sql) && /^\s*(select|with)\b/i.test(sql.trim());

const SQL = await initSqlJs({ wasmBinary: readFileSync(path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')) });
const db = new SQL.Database();
db.run(seed);

function run(sql) {
  const stmt = db.prepare(sql);
  const rows = [];
  while (stmt.step()) rows.push(stmt.get());
  stmt.free();
  return rows;
}

let pass = 0;
let fail = 0;
const expect = (label, cond) => (cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}`)));

// parts below reorder point: total on_hand < reorder_point
const belowReorder = run(`
  SELECT p.name, SUM(i.on_hand) AS on_hand, p.reorder_point
  FROM parts p JOIN inventory i ON i.part_id = p.id
  GROUP BY p.id HAVING SUM(i.on_hand) < p.reorder_point`);
expect('parts-below-reorder query returns rows', belowReorder.length > 0);

const suppliers = run(`SELECT name FROM suppliers WHERE avg_lead_time_days > 30`);
expect('long-lead-time suppliers query returns rows', suppliers.length === 3);

expect('read-only guard allows SELECT', isReadOnly('SELECT * FROM parts'));
expect('read-only guard allows REPLACE() function', isReadOnly("SELECT REPLACE(name,'a','b') FROM parts"));
expect('read-only guard blocks DELETE', !isReadOnly('DELETE FROM parts'));
expect('read-only guard blocks stacked statement', !isReadOnly('SELECT 1; DROP TABLE parts'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
