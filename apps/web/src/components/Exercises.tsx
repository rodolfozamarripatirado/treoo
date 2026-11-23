import { useState } from 'react';
import type { Exercise } from '../api';

export type ExerciseDraft = { type: Exercise['type']; prompt: string; options?: string[] | null; correctAnswer?: number | boolean | string | null; topic?: string | null; points?: number };
const TYPE_LABEL: Record<Exercise['type'], string> = { single_choice: 'Multiple choice', true_false: 'True or false', short_answer: 'Short answer' };

export function ExerciseSummary({ e }: { e: ExerciseDraft }) {
  return (
    <div>
      <div className="muted small">{TYPE_LABEL[e.type]}{e.points ? `, ${e.points} pt${e.points > 1 ? 's' : ''}` : ''}</div>
      <div>{e.prompt}</div>
      {e.type === 'single_choice' && <ol type="a" style={{ margin: '4px 0 0', paddingLeft: 20 }}>{(e.options ?? []).map((o, i) => <li key={i} style={{ fontWeight: i === e.correctAnswer ? 700 : 400 }}>{o}{i === e.correctAnswer ? ' (correct)' : ''}</li>)}</ol>}
      {e.type === 'true_false' && <div className="small">Answer: <strong>{e.correctAnswer ? 'True' : 'False'}</strong></div>}
      {e.type === 'short_answer' && e.correctAnswer && <div className="small">Model answer: {String(e.correctAnswer)}</div>}
    </div>
  );
}

export function ExerciseEditor({ initial, onSave, onCancel }: { initial?: ExerciseDraft; onSave: (e: ExerciseDraft) => void | Promise<void>; onCancel: () => void }) {
  const [e, setE] = useState<ExerciseDraft>(initial ?? { type: 'single_choice', prompt: '', options: ['', '', ''], correctAnswer: 0, points: 1 });
  const opts = e.options ?? ['', ''];
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
      <div className="grid-2">
        <label className="field">Type
          <select value={e.type} onChange={(x) => { const type = x.target.value as Exercise['type']; setE({ ...e, type, correctAnswer: type === 'single_choice' ? 0 : type === 'true_false' ? true : null, options: type === 'single_choice' ? opts : null }); }}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">Points<input type="number" min={1} max={100} value={e.points ?? 1} onChange={(x) => setE({ ...e, points: Math.max(1, Number(x.target.value) || 1) })} /></label>
      </div>
      <label className="field">Question<textarea rows={2} value={e.prompt} onChange={(x) => setE({ ...e, prompt: x.target.value })} /></label>
      {e.type === 'single_choice' && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Options — select the correct one</legend>
          {opts.map((o, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="radio" name="correct" style={{ width: 20, minHeight: 20 }} checked={e.correctAnswer === i} onChange={() => setE({ ...e, correctAnswer: i })} aria-label={`Option ${i + 1} is correct`} />
              <input value={o} onChange={(x) => setE({ ...e, options: opts.map((p, j) => (j === i ? x.target.value : p)) })} aria-label={`Option ${i + 1}`} />
              {opts.length > 2 && <button className="btn quiet" onClick={() => setE({ ...e, options: opts.filter((_, j) => j !== i), correctAnswer: 0 })}>Remove</button>}
            </div>
          ))}
          {opts.length < 6 && <button className="btn quiet" style={{ justifySelf: 'start' }} onClick={() => setE({ ...e, options: [...opts, ''] })}>Add option</button>}
        </fieldset>
      )}
      {e.type === 'true_false' && (
        <div className="row" role="radiogroup" aria-label="Correct answer">
          <label className="check"><input type="radio" checked={e.correctAnswer === true} onChange={() => setE({ ...e, correctAnswer: true })} />True</label>
          <label className="check"><input type="radio" checked={e.correctAnswer === false} onChange={() => setE({ ...e, correctAnswer: false })} />False</label>
        </div>
      )}
      {e.type === 'short_answer' && <label className="field">Model answer <span className="hint">Optional. You mark short answers yourself.</span><input value={String(e.correctAnswer ?? '')} onChange={(x) => setE({ ...e, correctAnswer: x.target.value })} /></label>}
      <div className="row"><button className="btn primary" onClick={() => void onSave(e)}>Save exercise</button><button className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
