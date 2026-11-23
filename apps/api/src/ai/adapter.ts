import { z } from 'zod';
import type { Env } from '../env.js';

/**
 * Backend AI adapter (08 §3-4). The frontend never talks to a model provider.
 * Modes: manual (disabled), mock (labelled simulated output), ollama (real inference).
 * Every result states its origin so simulated output is never mistaken for AI quality evidence.
 */

export const DraftActivitySchema = z.object({
  kind: z.string().max(60).nullable().optional(),
  title: z.string().max(200),
  instructions: z.string().max(4000).nullable().optional(),
  durationMinutes: z.number().positive().finite().max(600).nullable().optional(),
});

export const DraftExerciseSchema = z.object({
  type: z.enum(['single_choice', 'true_false', 'short_answer']),
  prompt: z.string().min(1).max(1000),
  options: z.array(z.string().max(300)).max(6).nullable().optional(),
  correctAnswer: z.union([z.number().int(), z.boolean(), z.string(), z.null()]).optional(),
});

export const LessonDraftSchema = z.object({
  title: z.string().min(1).max(200),
  topic: z.string().max(200).nullable().optional(),
  level: z.string().max(40).nullable().optional(),
  objective: z.string().max(2000).nullable().optional(),
  methodology: z.string().max(2000).nullable().optional(),
  activities: z.array(DraftActivitySchema).max(20),
  exercises: z.array(DraftExerciseSchema).max(10).default([]),
});

export type LessonDraft = z.infer<typeof LessonDraftSchema>;

export const VocabSuggestionSchema = z.object({
  items: z.array(z.object({
    term: z.string().min(1).max(120),
    partOfSpeech: z.string().max(40).nullable().optional(),
    meaning: z.string().max(400).nullable().optional(),
    example: z.string().max(400).nullable().optional(),
  })).max(20),
});
export type VocabSuggestion = z.infer<typeof VocabSuggestionSchema>['items'];
export type AiOrigin = 'mock' | 'ollama';

export interface DraftRequest {
  sourceText: string;
  level?: string | null;
  topic?: string | null;
  totalMinutes?: number | null;
  preferences?: string | null;
}

export interface AiAdapter {
  mode: Env['AI_MODE'];
  status(): Promise<{ mode: Env['AI_MODE']; available: boolean; detail: string; models?: { text: string; vision: string } }>;
  extract(image: { base64: string; mime: string }): Promise<{ text: string; origin: AiOrigin }>;
  draftLesson(req: DraftRequest): Promise<{ draft: LessonDraft; origin: AiOrigin; model: string }>;
  suggestVocab(req: { sourceText: string; level?: string | null; max?: number }): Promise<{ items: VocabSuggestion; origin: AiOrigin }>;
}

const vocabJsonSchema = {
  type: 'object', required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', required: ['term', 'partOfSpeech', 'meaning', 'example'],
    properties: { term: { type: 'string' }, partOfSpeech: { type: 'string' }, meaning: { type: 'string' }, example: { type: 'string' } } } } },
};

export class AiUnavailableError extends Error {}

// JSON Schema handed to Ollama structured outputs.
const lessonJsonSchema = {
  type: 'object',
  required: ['title', 'topic', 'level', 'objective', 'methodology', 'activities', 'exercises'],
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    level: { type: 'string' },
    objective: { type: 'string' },
    methodology: { type: 'string' },
    activities: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'title', 'instructions', 'durationMinutes'],
        properties: {
          kind: { type: 'string', enum: ['warm-up', 'presentation', 'controlled practice', 'freer practice', 'speaking', 'listening', 'reading', 'writing', 'review', 'homework'] },
          title: { type: 'string' },
          instructions: { type: 'string' },
          durationMinutes: { type: 'number' },
        },
      },
    },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'prompt', 'options', 'correctAnswer'],
        properties: {
          type: { type: 'string', enum: ['single_choice', 'true_false', 'short_answer'] },
          prompt: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctAnswer: {},
        },
      },
    },
  },
};

function draftPrompt(r: DraftRequest): string {
  return [
    'You are an experienced teacher of English as a foreign language preparing a face-to-face class.',
    'Using ONLY the source material below, propose a structured lesson in British English.',
    `Target level: ${r.level ?? 'infer from the material'}. Topic: ${r.topic ?? 'infer from the material'}.`,
    `Total class time: ${r.totalMinutes ?? 60} minutes; activity durations should add up to roughly that.`,
    r.preferences ? `Teacher preferences: ${r.preferences}` : '',
    'Include 3 to 7 activities with clear instructions for the teacher, and 2 to 5 practice exercises for students.',
    'For single_choice give 3-4 options and correctAnswer as the 0-based index. For true_false correctAnswer is a boolean.',
    'For short_answer correctAnswer is a model answer string. Do not invent facts that are not supported by the source.',
    '',
    'SOURCE MATERIAL:',
    r.sourceText.slice(0, 12000),
  ].filter(Boolean).join('\n');
}

const EXTRACT_PROMPT =
  'Transcribe all readable text in this textbook or worksheet image exactly, preserving headings, numbering, ' +
  'exercise items, options and tables (as Markdown). Mark illegible fragments as [Unclear]. Do not add explanations ' +
  'and never invent missing words. Return only the transcription.';

export function createOllamaAdapter(env: Env, fetchImpl: typeof fetch = fetch): AiAdapter {
  const call = async (body: unknown) => {
    const res = await fetchImpl(`${env.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT_MS),
    }).catch((e: unknown) => { throw new AiUnavailableError(`AI service unreachable: ${(e as Error).message}`); });
    if (!res.ok) throw new AiUnavailableError(`AI service returned ${res.status}.`);
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? '';
  };
  return {
    mode: 'ollama',
    async status() {
      try {
        const res = await fetchImpl(`${env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return { mode: 'ollama', available: false, detail: `Ollama returned ${res.status}.` };
        const tags = (await res.json()) as { models?: { name: string }[] };
        const names = new Set((tags.models ?? []).map((m) => m.name));
        const missing = [env.OLLAMA_TEXT_MODEL, env.OLLAMA_VISION_MODEL].filter((m) => !names.has(m) && !names.has(`${m}:latest`));
        return {
          mode: 'ollama',
          available: missing.length === 0,
          detail: missing.length ? `Missing models: ${missing.join(', ')}` : 'Ollama ready.',
          models: { text: env.OLLAMA_TEXT_MODEL, vision: env.OLLAMA_VISION_MODEL },
        };
      } catch (e) {
        return { mode: 'ollama', available: false, detail: `Ollama unreachable: ${(e as Error).message}` };
      }
    },
    async extract(image) {
      const content = await call({
        model: env.OLLAMA_VISION_MODEL,
        stream: false,
        options: { temperature: 0 },
        messages: [{ role: 'user', content: EXTRACT_PROMPT, images: [image.base64] }],
      });
      return { text: content.trim(), origin: 'ollama' };
    },
    async draftLesson(r) {
      const content = await call({
        model: env.OLLAMA_TEXT_MODEL,
        stream: false,
        think: false,
        format: lessonJsonSchema,
        options: { temperature: 0.3 },
        messages: [{ role: 'user', content: draftPrompt(r) }],
      });
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { throw new AiUnavailableError('The AI returned an invalid draft. Try again or continue manually.'); }
      const result = LessonDraftSchema.safeParse(sanitiseDraft(parsed));
      if (!result.success) throw new AiUnavailableError('The AI draft did not match the expected structure. Try again or continue manually.');
      return { draft: result.data, origin: 'ollama', model: env.OLLAMA_TEXT_MODEL };
    },
    async suggestVocab(r) {
      const content = await call({
        model: env.OLLAMA_TEXT_MODEL, stream: false, think: false, format: vocabJsonSchema, options: { temperature: 0.2 },
        messages: [{ role: 'user', content: [
          `Pick up to ${r.max ?? 10} key vocabulary items (words, collocations, phrasal verbs) a ${r.level ?? 'B1'} learner should learn from this material.`,
          'For each give the part of speech, a short learner-friendly meaning in simple British English, and an example sentence from or close to the material.',
          'Use only language that appears in the material.', '', 'MATERIAL:', r.sourceText.slice(0, 8000)].join('\n') }],
      });
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { throw new AiUnavailableError('The AI returned an invalid vocabulary list. Try again or add words manually.'); }
      const result = VocabSuggestionSchema.safeParse(parsed);
      if (!result.success) throw new AiUnavailableError('The AI vocabulary list did not match the expected structure.');
      return { items: result.data.items.filter((i) => i.term.trim()), origin: 'ollama' };
    },
  };
}

/** Drops invalid values the model may emit (e.g. 0-minute durations) instead of failing the whole draft. */
function sanitiseDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const d = raw as Record<string, unknown>;
  const acts = Array.isArray(d.activities) ? d.activities : [];
  const exs = Array.isArray(d.exercises) ? d.exercises : [];
  return {
    ...d,
    activities: acts.slice(0, 20).map((a: Record<string, unknown>) => ({
      ...a,
      durationMinutes: typeof a.durationMinutes === 'number' && a.durationMinutes > 0 && a.durationMinutes <= 600 ? a.durationMinutes : null,
    })),
    exercises: exs.slice(0, 10).filter((e: Record<string, unknown>) => typeof e.prompt === 'string' && e.prompt.trim()).map((e: Record<string, unknown>) => {
      if (e.type === 'single_choice') {
        const options = Array.isArray(e.options) ? e.options.map(String).slice(0, 6) : [];
        const idx = typeof e.correctAnswer === 'number' ? e.correctAnswer : Number(e.correctAnswer);
        return { ...e, options, correctAnswer: Number.isInteger(idx) && idx >= 0 && idx < options.length ? idx : 0 };
      }
      if (e.type === 'true_false') return { ...e, options: null, correctAnswer: e.correctAnswer === true || e.correctAnswer === 'true' };
      return { ...e, type: 'short_answer', options: null, correctAnswer: e.correctAnswer == null ? null : String(e.correctAnswer) };
    }),
  };
}

// ---------------- Mock (simulated) ----------------

export function createMockAdapter(): AiAdapter {
  return {
    mode: 'mock',
    async status() {
      return { mode: 'mock', available: true, detail: 'Simulated AI: output is a placeholder, not real model quality.' };
    },
    async extract() {
      return {
        origin: 'mock',
        text: [
          '# Unit 4 — Present Perfect (simulated extraction)',
          '',
          'We use the present perfect to talk about experiences and recent actions with a result now.',
          'Form: have/has + past participle.',
          '',
          '1. I ___ (visit) London three times.',
          '2. She ___ (not finish) her homework yet.',
          '3. ___ you ever ___ (try) haggis?',
          '',
          '[Unclear] — simulated output. Replace with the real text of your worksheet.',
        ].join('\n'),
      };
    },
    async draftLesson(r) {
      const firstLine = r.sourceText.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? 'Lesson';
      const topic = r.topic ?? firstLine.replace(/\(.*?\)/g, '').replace(/^Unit\s*\d+\s*[—-]\s*/i, '').trim().slice(0, 80);
      const total = r.totalMinutes ?? 60;
      const parts: [string, string, string, number][] = [
        ['warm-up', 'Warm-up discussion', `Ask students to share personal examples related to ${topic}.`, 0.15],
        ['presentation', `Present: ${topic}`, 'Elicit the form and use from the material; board key examples and concept-check questions.', 0.25],
        ['controlled practice', 'Controlled practice', 'Students complete the items from the worksheet in pairs, then check as a class.', 0.25],
        ['speaking', 'Freer speaking', `Find someone who… using ${topic}. Monitor and note errors for delayed correction.`, 0.25],
        ['review', 'Wrap-up and error correction', 'Review common errors on the board and set homework.', 0.1],
      ];
      return {
        origin: 'mock',
        model: 'simulated',
        draft: {
          title: `${topic} (draft)`,
          topic,
          level: r.level ?? 'B1',
          objective: `By the end of the class, students can use ${topic} accurately in short spoken and written exchanges.`,
          methodology: 'PPP (presentation, practice, production) — simulated proposal.',
          activities: parts.map(([kind, title, instructions, share]) => ({ kind, title, instructions, durationMinutes: Math.round(total * share * 2) / 2 })),
          exercises: [
            { type: 'single_choice', prompt: 'Choose the correct sentence.', options: ['I have visited London last year.', 'I have visited London three times.', 'I visit London since 2020.'], correctAnswer: 1 },
            { type: 'true_false', prompt: '"She has finished her homework yet." is correct.', options: null, correctAnswer: false },
            { type: 'short_answer', prompt: 'Write one sentence about an experience you have had.', options: null, correctAnswer: null },
          ],
        },
      };
    },
    async suggestVocab(r) {
      // Simulated: longest distinct words of the material, without meanings. Clearly a placeholder.
      const stop = new Set(['students', 'complete', 'sentences', 'following', 'example', 'speaking', 'someone', 'between', 'because', 'something']);
      const words = [...new Set((r.sourceText.toLowerCase().match(/[a-z][a-z'-]{5,}/g) ?? []).filter((w) => !stop.has(w)))];
      const picked = words.sort((a, b) => b.length - a.length).slice(0, r.max ?? 8);
      const sentence = (w: string) => r.sourceText.split(/(?<=[.!?\n])/).map((x) => x.trim()).find((x) => x.toLowerCase().includes(w)) ?? null;
      return { origin: 'mock', items: picked.map((term) => ({ term, partOfSpeech: null, meaning: null, example: sentence(term) })) };
    },
  };
}

export function createManualAdapter(): AiAdapter {
  const off = async (): Promise<never> => { throw new AiUnavailableError('AI assistance is turned off. Continue manually.'); };
  return {
    mode: 'manual',
    async status() { return { mode: 'manual', available: false, detail: 'AI assistance is turned off. The manual route is fully available.' }; },
    extract: off,
    draftLesson: off,
    suggestVocab: off,
  };
}

export function createAiAdapter(env: Env): AiAdapter {
  if (env.AI_MODE === 'ollama') return createOllamaAdapter(env);
  if (env.AI_MODE === 'mock') return createMockAdapter();
  return createManualAdapter();
}
