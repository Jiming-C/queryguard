import Anthropic from '@anthropic-ai/sdk';

// One small seam so the app doesn't care who's answering. If you have a paid
// Anthropic key it uses that; otherwise it falls back to any free provider you
// have a key for. The free ones all speak the OpenAI chat-completions shape, so
// a single fetch covers Groq, OpenRouter, Gemini, Cerebras, or anything else
// with an OpenAI-compatible endpoint. Set exactly one key and you're done — no
// paid key required to run the demo.

type OpenAiProvider = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

// Auto-detected by which key is present. Model ids are current free-tier
// defaults; override any of them with LLM_MODEL. Groq is the recommended free
// option — no credit card, fastest setup. (Model ids verified mid-2026; if one
// starts 404ing, the provider retired it — set LLM_MODEL to a current one.)
const PRESETS = [
  { env: 'GROQ_API_KEY', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' },
  { env: 'CEREBRAS_API_KEY', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b' },
  { env: 'GEMINI_API_KEY', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash-lite' },
  { env: 'OPENROUTER_API_KEY', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-20b:free' },
] as const;

function resolveOpenAiProvider(): OpenAiProvider | null {
  // A fully custom endpoint wins if you've set one explicitly.
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    return {
      name: 'custom',
      baseUrl: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      apiKey: process.env.LLM_API_KEY,
    };
  }
  for (const preset of PRESETS) {
    const apiKey = process.env[preset.env];
    if (apiKey) {
      return { name: preset.name, baseUrl: preset.baseUrl, model: process.env.LLM_MODEL || preset.model, apiKey };
    }
  }
  return null;
}

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// system + one user turn in, plain text out. temperature 0 where the provider
// supports it — grounding the prompt in the schema does most of the work, but
// there's no reason to add sampling noise to SQL generation.
export async function complete(system: string, user: string, maxTokens = 512): Promise<string> {
  if (anthropic) return anthropicComplete(system, user, maxTokens);

  const provider = resolveOpenAiProvider();
  if (provider) return openAiComplete(provider, system, user, maxTokens);

  throw new Error(
    'No LLM provider configured. Set ANTHROPIC_API_KEY, or a free key such as GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY. See the README.',
  );
}

async function anthropicComplete(system: string, user: string, maxTokens: number): Promise<string> {
  const message = await anthropic!.messages.create({
    model: anthropicModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

async function openAiComplete(
  provider: OpenAiProvider,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${provider.apiKey}`,
  };
  // OpenRouter likes these for attribution; harmless everywhere else.
  if (provider.name === 'OpenRouter') {
    headers['HTTP-Referer'] = 'https://github.com/jiming-c/queryguard';
    headers['X-Title'] = 'QueryGuard';
  }

  // One trailing slash exactly — Gemini's base ends in /openai and some custom
  // base URLs come with a slash already.
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${provider.name} request failed (${res.status}). ${body.slice(0, 200)}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
