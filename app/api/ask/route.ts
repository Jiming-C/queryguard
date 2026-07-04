import { answer } from '@/lib/guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const question = body?.question;

  if (typeof question !== 'string' || !question.trim()) {
    return Response.json({ error: 'Ask a question about the data.' }, { status: 400 });
  }

  try {
    const result = await answer(question.trim().slice(0, 500));
    return Response.json(result);
  } catch (err) {
    // Usually a missing or invalid provider key. Say so plainly rather than
    // returning a stack trace.
    const status = (err as { status?: number })?.status;
    const detail =
      status === 401
        ? 'The LLM provider rejected the API key. Check the key you set (Anthropic, or a free one like GROQ_API_KEY).'
        : (err as Error)?.message || 'Something went wrong.';
    return Response.json({ error: detail }, { status: 500 });
  }
}
