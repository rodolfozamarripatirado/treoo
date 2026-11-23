import { describe, expect, it } from 'vitest';
import { AiUnavailableError, createOpenRouterAdapter } from '../src/ai/adapter.js';
import { loadEnv } from '../src/env.js';

const KEY = 'sk-or-v1-test-key-not-real';
const env = loadEnv({ NODE_ENV: 'test', AI_MODE: 'openrouter', OPENROUTER_API_KEY: KEY });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const completion = (content: string) => json({ choices: [{ message: { content } }] });
const draft = { title: 'Second conditional', topic: 'Conditionals', level: 'B2', objective: 'x', methodology: 'PPP',
  activities: [{ kind: 'warm-up', title: 'Dreams', instructions: 'Discuss', durationMinutes: 10 }],
  exercises: [{ type: 'single_choice', prompt: 'Pick', options: ['a', 'b'], correctAnswer: 1 }] };

describe('OpenRouter adapter', () => {
  it('sends a strict structured-output request with privacy routing and the key only in the header', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ai = createOpenRouterAdapter(env, (async (url: string, init: RequestInit) => { calls.push({ url, init }); return completion(JSON.stringify(draft)); }) as unknown as typeof fetch);
    const r = await ai.draftLesson({ sourceText: 'If I won the lottery…' });
    expect(r).toMatchObject({ origin: 'openrouter', model: 'qwen/qwen3-vl-30b-a3b-instruct' });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(String(calls[0]!.init.body)).not.toContain(KEY);
    expect(body.provider).toEqual({ data_collection: 'deny', require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it('sends photos as data URLs to the vision model', async () => {
    let body: { model: string; messages: { content: { type: string; image_url?: { url: string } }[] }[] } | null = null;
    const ai = createOpenRouterAdapter(env, (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return completion('Unit 4\n1. I ___'); }) as unknown as typeof fetch);
    const r = await ai.extract({ base64: 'AAAA', mime: 'image/jpeg' });
    expect(r).toEqual({ text: 'Unit 4\n1. I ___', origin: 'openrouter' });
    expect(body!.messages[0]!.content[1]!.image_url!.url).toBe('data:image/jpeg;base64,AAAA');
  });

  it('falls back to a JSON instruction when no endpoint supports structured outputs, and accepts fenced JSON', async () => {
    let n = 0;
    const ai = createOpenRouterAdapter(env, (async (_u: string, init: RequestInit) => {
      n++;
      if (n === 1) return json({ error: { message: 'No endpoints found' } }, 404);
      expect(JSON.parse(String(init.body)).response_format).toBeUndefined();
      return completion('```json\n{"items":[{"term":"so far","partOfSpeech":"phrase","meaning":"until now","example":"So far so good."}]}\n```');
    }) as unknown as typeof fetch);
    const r = await ai.suggestVocab({ sourceText: 'So far so good.' });
    expect(n).toBe(2);
    expect(r.items[0]!.term).toBe('so far');
  });

  it('turns key, credit and rate-limit problems into clear messages without leaking the key', async () => {
    for (const [status, msg] of [[401, 'rejected the API key'], [402, 'no credit'], [429, 'rate limit']] as const) {
      const ai = createOpenRouterAdapter(env, (async () => json({ error: { message: 'x' } }, status)) as unknown as typeof fetch);
      const err = await ai.draftLesson({ sourceText: 'x' }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(AiUnavailableError);
      expect((err as Error).message).toContain(msg);
      expect((err as Error).message).not.toContain(KEY);
    }
    const noKey = createOpenRouterAdapter(loadEnv({ NODE_ENV: 'test', AI_MODE: 'openrouter', OPENROUTER_API_KEY: '' }));
    expect((await noKey.status()).available).toBe(false);
  });

  it('reports availability and remaining credit', async () => {
    const ai = createOpenRouterAdapter(env, (async () => json({ data: { limit_remaining: 4.5 } })) as unknown as typeof fetch);
    const s = await ai.status();
    expect(s.available).toBe(true);
    expect(s.detail).toContain('$4.50');
  });
});
