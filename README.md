# QueryGuard

Ask a demand-planning database in plain English. It generates SQL, runs it, and — the part most text-to-SQL demos skip — **checks whether the result actually answers the question before it trusts it.**

## Why

Text-to-SQL demos usually go: question → SQL → run → show the rows. That's the easy 80%. The failure mode that actually bites is the query that runs cleanly and returns a perfectly reasonable-looking number while answering a *different* question than you asked — a missing `GROUP BY`, an `AVG` where you wanted `SUM`, a filter on the wrong column. Nothing errors. It just looks like an answer, so people ship decisions on top of it.

I've spent time on LLM reliability over structured data (a citation-grounded RAG guardrail for a NotebookLM-style tool, a triage system with deterministic fallback when the model's annotation fails), and this is the same shape of problem: *valid output, wrong answer.* So the interesting thing to build isn't the generator — it's the guardrail around it.

## What it does

Every question goes through the same pipeline in [`lib/guard.ts`](lib/guard.ts):

1. **Generate** a SQL query from the question, grounded in the schema.
2. **Read-only check** — reject anything that isn't a single `SELECT`. A demo over a shared DB has no business running writes.
3. **Schema check** — actually prepare the query against the real database. An unknown column throws here, which catches the model inventing a field.
4. **Grounding check** — hand the question, the SQL, and the result back to the model and ask, skeptically, whether they actually match. This is the "valid but wrong" catcher.
5. **Self-consistency** — generate a *second* query from scratch and compare results. If two independent queries disagree, the question was ambiguous or one of them is wrong.

If everything passes, you get the answer marked **verified**. If a check trips, you still see the query and rows, but marked **draft, not a fact**, with the reason. If it can't even produce valid SQL, it says so instead of guessing.

The point: it would rather tell you it's unsure than hand you a confident wrong number.

## Stack

- **Next.js** (App Router) on Vercel
- **sql.js** — SQLite compiled to WebAssembly, seeded in memory on each cold start. No database to provision; every query is read-only.
- **Any LLM** — one call to write the SQL, one to verify grounding, one for the second opinion. The provider is auto-detected from whichever API key you set (see below), so it runs on a paid Anthropic key *or* a free one.

The sample database is a small demand-planning slice: factories, parts, inventory, suppliers with lead times, and weekly demand forecast vs. actual. See [`lib/schema.ts`](lib/schema.ts).

## Providers (runs free)

You don't need a paid key. The app looks at your environment and uses whatever it finds, in this order:

1. `ANTHROPIC_API_KEY` — uses Claude (`claude-sonnet-4-6` by default)
2. A free provider key — `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY` — called through its OpenAI-compatible endpoint
3. `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` — any other OpenAI-compatible endpoint

**Free default — Groq, no credit card, about a minute:**

1. Sign up at https://console.groq.com (email, Google, or GitHub — no card).
2. Create a key at https://console.groq.com/keys and copy it.
3. Put it in `.env.local` as `GROQ_API_KEY=...`.

That's it — the app calls `openai/gpt-oss-20b` on Groq. Set `LLM_MODEL=openai/gpt-oss-120b` for stronger SQL. Cerebras and Google AI Studio are also card-free (Gemini needs billing enabled in the EEA/UK/Switzerland); OpenRouter's free models work once you flip the privacy toggle at openrouter.ai/settings/privacy.

> Free tiers may log prompts and train on them, and they rate-limit hard (roughly a handful of requests per minute). That's fine here — the database is synthetic sample data, and each question is only three calls. Don't point this at real/sensitive data on a free key.

## Run it

```bash
npm install
cp .env.example .env.local     # set GROQ_API_KEY (or any provider key)
npm run dev
```

Then open http://localhost:3000.

`npm run check` runs an offline sanity check (seed loads, queries run, the read-only guard behaves) — no API key needed.

## Deploy

Push to GitHub, import the repo in Vercel, and set your provider key (e.g. `GROQ_API_KEY`) as an environment variable. The `/api/ask` route runs on the Node.js runtime (sql.js needs it), and `next.config.mjs` traces the WebAssembly binary into the function bundle.

## Limitations (on purpose)

- The grounding and self-consistency checks are themselves model calls, so they're a strong signal, not a proof. A production version would add a query cost/row-count sanity bound and log every flagged answer for review.
- The database is tiny and in-memory. It's here to make the reliability behavior easy to see, not to be a warehouse.
