'use client';

import { useState } from 'react';
import { SAMPLE_QUESTIONS } from '@/lib/schema';

type Check = { name: string; ok: boolean; detail: string };

type Answer = {
  question: string;
  sql: string | null;
  columns: string[];
  rows: unknown[][];
  checks: Check[];
  confidence: 'high' | 'low' | 'blocked';
  verdict: string;
  note?: string;
};

export default function Home() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Request failed.');
      else setAnswer(data);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>QueryGuard</h1>
      <p className="tagline">
        Ask a demand-planning database in plain English. The hard part of text-to-SQL isn&apos;t writing the
        query — it&apos;s catching the query that runs cleanly and answers the wrong question. This one checks
        itself before it trusts the result.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          type="text"
          value={question}
          placeholder="e.g. which parts are below their reorder point?"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Checking…' : 'Ask'}
        </button>
      </form>

      <div className="samples">
        {SAMPLE_QUESTIONS.map((q) => (
          <button key={q} type="button" onClick={() => ask(q)} disabled={loading}>
            {q}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      {answer && (
        <div className="card">
          <div className={`verdict ${answer.confidence}`}>{answer.verdict}</div>
          {answer.note && <div className="note">{answer.note}</div>}

          {answer.checks.length > 0 && (
            <ul className="checks">
              {answer.checks.map((c) => (
                <li key={c.name}>
                  <span className={`dot ${c.ok ? 'pass' : 'fail'}`} />
                  <span>
                    <span className="check-name">{c.name}</span>
                    {c.detail && <span className="check-detail"> — {c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {answer.sql && <pre className="sql">{answer.sql}</pre>}

          {answer.rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {answer.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {answer.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell === null ? '—' : String(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <footer>
        In-memory SQLite (sql.js) seeded on each cold start · queries generated and verified with the Anthropic
        API · the schema is a small demand-planning slice: factories, parts, inventory, suppliers, weekly demand.
      </footer>
    </main>
  );
}
