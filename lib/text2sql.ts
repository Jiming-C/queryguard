import { complete } from './llm';
import { SCHEMA_DOC } from './schema';

const SYSTEM = `You turn a business question into a single SQLite query.

Rules:
- Output ONLY the SQL. No markdown, no explanation, no trailing commentary.
- Exactly one statement, and it must be a SELECT. Never write, update, delete, or run DDL.
- Use only the tables and columns in the schema. Do not invent columns or tables.
- Follow the business rules in the schema notes (e.g. how "on hand" and "below reorder point" are defined).
- If the question can't be answered from this schema, output exactly: CANNOT_ANSWER

Schema:
${SCHEMA_DOC}`;

// `hint` lets the guard ask for a second, independently-derived query when it
// wants to cross-check the first one.
export async function generateSql(question: string, hint = ''): Promise<string> {
  const raw = await complete(SYSTEM + hint, question, 400);
  return stripFences(raw);
}

function stripFences(text: string): string {
  let sql = text.trim();
  const fenced = sql.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced) sql = fenced[1].trim();
  return sql.replace(/;\s*$/, '').trim();
}
