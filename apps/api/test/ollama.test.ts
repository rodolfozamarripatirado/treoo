import { describe, expect, it } from 'vitest';
import { AiUnavailableError, createOllamaAdapter } from '../src/ai/adapter.js';
import { loadEnv } from '../src/env.js';

const env = loadEnv({ NODE_ENV: 'test', AI_MODE: 'ollama', OLLAMA_URL: 'http://ollama.test:11434' });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Ollama adapter contract', () => {
  it('sends a structured-output request to the text model and validates the draft', async () => {
    let sent: { model: string; format: unknown; think: boolean } | null = null;
    const fetchStub = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return reply({ message: { content: JSON.stringify({
        title: 'Second conditional', topic: 'Conditionals', level: 'B2', objective: 'x', methodology: 'PPP',
        activities: [{ kind: 'warm-up', title: 'Dreams', instructions: 'Discuss', durationMinutes: 0 }, { kind: 'presentation', title: 'Form', instructions: 'Board', durationMinutes: 12.5 }],
        exercises: [{ type: 'single_choice', prompt: 'Pick', options: ['a', 'b'], correctAnswer: 7 }, { type: 'true_false', prompt: 'T?', options: [], correctAnswer: 'true' }],
      }) } });
    }) as unknown as typeof fetch;
    const ai = createOllamaAdapter(env, fetchStub);
    const r = await ai.draftLesson({ sourceText: 'If I won…', totalMinutes: 60 });
    expect(sent!.model).toBe('qwen3:8b');
    expect(sent!.think).toBe(false);
    expect(sent!.format).toMatchObject({ type: 'object' });
    expect(r.origin).toBe('ollama');
    // Invalid values from the model are neutralised instead of failing the whole draft.
    expect(r.draft.activities[0]!.durationMinutes).toBeNull();
    expect(r.draft.activities[1]!.durationMinutes).toBe(12.5);
    expect(r.draft.exercises[0]!.correctAnswer).toBe(0);
    expect(r.draft.exercises[1]!.correctAnswer).toBe(true);
  });

  it('uses the vision model with the image for extraction', async () => {
    let sent: { model: string; messages: { images: string[] }[] } | null = null;
    const ai = createOllamaAdapter(env, (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return reply({ message: { content: ' Unit 4\n1. I ___ ' } }); }) as unknown as typeof fetch);
    const r = await ai.extract({ base64: 'AAAA', mime: 'image/png' });
    expect(sent!.model).toBe('qwen3-vl:4b-instruct');
    expect(sent!.messages[0]!.images).toEqual(['AAAA']);
    expect(r.text).toBe('Unit 4\n1. I ___');
  });

  it('reports unavailability clearly so the manual route can continue', async () => {
    const down = createOllamaAdapter(env, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    await expect(down.draftLesson({ sourceText: 'x' })).rejects.toBeInstanceOf(AiUnavailableError);
    const garbage = createOllamaAdapter(env, (async () => reply({ message: { content: 'not json' } })) as unknown as typeof fetch);
    await expect(garbage.draftLesson({ sourceText: 'x' })).rejects.toBeInstanceOf(AiUnavailableError);
    const status = await createOllamaAdapter(env, (async () => reply({ models: [{ name: 'qwen3:8b' }] })) as unknown as typeof fetch).status();
    expect(status).toMatchObject({ available: false, detail: 'Missing models: qwen3-vl:4b-instruct' });
  });
});
