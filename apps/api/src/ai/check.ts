/**
 * Quick end-to-end check of the configured AI provider, without the database.
 *   AI_MODE=openrouter OPENROUTER_API_KEY=... npm run ai:check -w apps/api
 * Prints availability, then times a small lesson draft and a vocabulary suggestion.
 */
import { createAiAdapter } from './adapter.js';
import { loadEnv } from '../env.js';

const SAMPLE = [
  'Unit 4 — Present Perfect: life experiences',
  'We use the present perfect (have/has + past participle) to talk about experiences.',
  '1. I ___ (be) to Scotland twice.  2. ___ you ever ___ (eat) sushi?  3. She ___ (never / see) the sea.',
  'Speaking: Find someone who has… ridden a horse / met a famous person / lost a phone.',
].join('\n');

const env = loadEnv();
const ai = createAiAdapter(env);
const status = await ai.status();
console.log(`Mode: ${status.mode}\nStatus: ${status.available ? 'available' : 'NOT available'} — ${status.detail}`);
if (!status.available) process.exit(1);

const time = async <T>(label: string, fn: () => Promise<T>) => {
  const t = Date.now();
  try { const r = await fn(); console.log(`\n✔ ${label} in ${((Date.now() - t) / 1000).toFixed(1)} s`); return r; }
  catch (e) { console.log(`\n✘ ${label} failed after ${((Date.now() - t) / 1000).toFixed(1)} s: ${(e as Error).message}`); process.exitCode = 1; return null; }
};
const d = await time('Lesson draft', () => ai.draftLesson({ sourceText: SAMPLE, level: 'B1', totalMinutes: 60 }));
if (d) {
  console.log(`  ${d.draft.title} (${d.model})`);
  for (const a of d.draft.activities) console.log(`  - ${a.title} [${a.kind ?? '?'}] ${a.durationMinutes ?? '?'} min`);
  console.log(`  ${d.draft.exercises.length} exercises`);
}
const v = await time('Vocabulary suggestion', () => ai.suggestVocab({ sourceText: SAMPLE, level: 'B1', max: 6 }));
if (v) for (const w of v.items) console.log(`  - ${w.term}: ${w.meaning ?? ''}`);
