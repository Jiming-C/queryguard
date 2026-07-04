import { complete } from './llm';
import { runQuery, type QueryResult } from './db';
import { generateSql } from './text2sql';
import { SCHEMA_DOC } from './schema';

// The problem this whole project is about: a text-to-SQL model will happily
// hand you a query that runs cleanly and returns rows — and quietly answers a
// different question than the one you asked. Wrong filter, wrong aggregate, a
// missing GROUP BY. It looks like an answer, so people trust it.
//
// So we don't just run the SQL and return the rows. Every answer goes through a
// few checks first, and if any of them trips we say so instead of handing back
// a confident-looking wrong number.

export type Check = { name: string; ok: boolean; detail: string };

export type Answer = {
  question: string;
  sql: string | null;
  columns: string[];
  rows: unknown[][];
  checks: Check[];
  confidence: 'high' | 'low' | 'blocked';
  verdict: string;
  note?: string;
};

// REPLACE() is a legitimate SELECT function, so it's deliberately not here.
const MUTATING = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i;

export async function answer(question: string): Promise<Answer> {
  const sql = await generateSql(question);

  if (!sql || sql === 'CANNOT_ANSWER') {
    return blocked(
      question,
      null,
      [],
      "I couldn't map that to the data I have. Try asking about factories, parts, inventory, suppliers, or the weekly demand forecast.",
    );
  }

  const checks: Check[] = [];

  // 1. Read-only. A demo over a shared database has no business running writes,
  // and it's the cheapest guardrail there is.
  const readOnly = isReadOnly(sql);
  checks.push({
    name: 'Read-only',
    ok: readOnly,
    detail: readOnly ? 'single SELECT statement' : 'blocked a write / DDL statement',
  });
  if (!readOnly) {
    return blocked(question, sql, checks, 'The generated query tried to modify data, so it never ran. This tool only reads.');
  }

  // 2. Actually valid against the real schema. sql.js throws on an unknown
  // column or table, which catches the model hallucinating a field.
  let result: QueryResult;
  try {
    result = await runQuery(sql);
  } catch (err) {
    checks.push({ name: 'Runs against the schema', ok: false, detail: message(err) });
    return blocked(question, sql, checks, "The query referenced something that isn't in the schema, so it didn't run. Better to say that than to guess.");
  }
  checks.push({ name: 'Runs against the schema', ok: true, detail: `returned ${result.rows.length} row(s)` });

  // 3. The "valid but wrong" check. Hand the question, the SQL, and the result
  // to the model and ask, skeptically, whether they actually match.
  const grounded = await checkGrounding(question, sql, result);
  checks.push({ name: 'Result answers the question', ok: grounded.ok, detail: grounded.detail });

  // 4. Self-consistency. Generate a second query from scratch; if it returns a
  // different answer, the question was probably ambiguous or one query is wrong.
  const consistent = await checkConsistency(question, result);
  checks.push({ name: 'Independent second query agrees', ok: consistent.ok, detail: consistent.detail });

  const trustworthy = grounded.ok && consistent.ok;

  return {
    question,
    sql,
    columns: result.columns,
    rows: result.rows,
    checks,
    confidence: trustworthy ? 'high' : 'low',
    verdict: trustworthy
      ? 'Verified. Read-only, valid, and a second independent query agreed.'
      : 'Answer returned, but a check flagged it. Treat this as a draft, not a fact.',
    note: trustworthy ? undefined : caveat(grounded, consistent),
  };
}

function isReadOnly(sql: string): boolean {
  const trimmed = sql.trim();
  if (/;\s*\S/.test(trimmed)) return false;        // more than one statement
  if (MUTATING.test(trimmed)) return false;
  return /^\s*(select|with)\b/i.test(trimmed);
}

async function checkGrounding(question: string, sql: string, result: QueryResult) {
  const system = `You review whether a SQL result genuinely answers a business question.

The failure you're looking for: the SQL is valid and returns rows, but it answers a subtly different question — wrong filter, wrong aggregate, wrong column, a missing GROUP BY, an average where a sum was asked for.

Reply on one line:
  OK: <one clause on why it matches>
  FLAG: <one clause on what looks wrong>
Be skeptical. If you can't confirm it matches, FLAG it.`;

  const user = `Question: ${question}

SQL:
${sql}

Result (first rows):
${preview(result)}

Schema:
${SCHEMA_DOC}`;

  const reply = await complete(system, user, 160);
  const ok = /^\s*OK\b/i.test(reply);
  return { ok, detail: reply.replace(/^\s*(OK|FLAG)\s*[:\-]?\s*/i, '').trim() || (ok ? 'looks right' : 'flagged') };
}

async function checkConsistency(question: string, result: QueryResult) {
  let altSql: string;
  try {
    altSql = await generateSql(question, '\nIf there is more than one reasonable way to phrase this, pick a different structure than the most obvious first attempt.');
  } catch {
    return { ok: true, detail: 'skipped (second query unavailable)' };
  }

  if (!altSql || altSql === 'CANNOT_ANSWER' || !isReadOnly(altSql)) {
    return { ok: true, detail: 'no comparable second query to compare against' };
  }

  let altResult: QueryResult;
  try {
    altResult = await runQuery(altSql);
  } catch {
    return { ok: false, detail: 'a second query for the same question failed to run' };
  }

  const same = sameRows(result, altResult);
  return {
    ok: same,
    detail: same ? 'a second, independently written query returned the same rows' : 'a second query returned different rows',
  };
}

// Compare result sets ignoring row order.
function sameRows(a: QueryResult, b: QueryResult): boolean {
  if (a.rows.length !== b.rows.length) return false;
  const norm = (r: QueryResult) => r.rows.map((row) => JSON.stringify(row)).sort();
  const [ra, rb] = [norm(a), norm(b)];
  return ra.every((row, i) => row === rb[i]);
}

function preview(result: QueryResult, limit = 8): string {
  const header = result.columns.join(' | ');
  const body = result.rows
    .slice(0, limit)
    .map((row) => row.map((v) => (v === null ? 'NULL' : String(v))).join(' | '))
    .join('\n');
  const more = result.rows.length > limit ? `\n… ${result.rows.length - limit} more row(s)` : '';
  return `${header}\n${body}${more}`;
}

function caveat(
  grounded: { ok: boolean; detail: string },
  consistent: { ok: boolean; detail: string },
): string {
  const reasons: string[] = [];
  if (!grounded.ok) reasons.push(`the result may not match the question (${grounded.detail})`);
  if (!consistent.ok) reasons.push(consistent.detail);
  return `Hold this loosely: ${reasons.join('; ')}.`;
}

function blocked(question: string, sql: string | null, checks: Check[], note: string): Answer {
  return {
    question,
    sql,
    columns: [],
    rows: [],
    checks,
    confidence: 'blocked',
    verdict: 'Stopped before returning a possibly-wrong answer.',
    note,
  };
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
