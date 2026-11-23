import { useState } from 'react';
import { api } from '../api';
import { ErrorNote, useToast } from './ui';

export interface Word { id?: string; term: string; partOfSpeech: string | null; meaning: string | null; example: string | null }

/** Lesson vocabulary editor. Saved separately from the lesson; AI suggestions are only added when the teacher picks them. */
export function VocabEditor({ lessonId, initial, aiAvailable }: { lessonId: string; initial: Word[]; aiAvailable: boolean }) {
  const [items, setItems] = useState<Word[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [sugs, setSugs] = useState<(Word & { pick: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast, node } = useToast();
  const dirty = JSON.stringify(items) !== saved;
  const set = (i: number, patch: Partial<Word>) => setItems(items.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api<Word[]>(`/lessons/${lessonId}/vocab`, { method: 'PUT', body: { items: items.filter((w) => w.term.trim()) } });
      setItems(r); setSaved(JSON.stringify(r)); toast('Vocabulary saved');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const suggest = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api<{ items: Word[]; origin: string }>('/ai/vocab', { body: { lessonId } });
      const known = new Set(items.map((w) => w.term.toLowerCase()));
      setSugs(r.items.filter((w) => !known.has(w.term.toLowerCase())).map((w) => ({ ...w, pick: true })));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="sheet stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Key vocabulary</h2>
        <span className="row">{aiAvailable && <button className="btn quiet" disabled={busy} onClick={suggest}>Suggest words with AI</button>}<button className="btn" onClick={() => setItems([...items, { term: '', partOfSpeech: null, meaning: null, example: null }])}>Add word</button></span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Students practise these as flashcards in their Vocabulary Lab once the class is published.</p>
      <ErrorNote msg={err} />
      {sugs && (
        <div className="notice info stack">
          <p><strong>Suggestions</strong> — tick the ones to add.{sugs.length === 0 && ' Nothing new found.'}</p>
          {sugs.map((s, i) => <label key={i} className="check"><input type="checkbox" checked={s.pick} onChange={() => setSugs(sugs.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)))} /><span><strong>{s.term}</strong>{s.meaning ? `, ${s.meaning}` : ''}</span></label>)}
          <div className="row"><button className="btn primary" onClick={() => { setItems([...items, ...sugs.filter((s) => s.pick).map(({ pick: _p, ...w }) => w)]); setSugs(null); }}>Add selected</button><button className="btn" onClick={() => setSugs(null)}>Dismiss</button></div>
        </div>
      )}
      <div className="vocab-table">
        {items.map((w, i) => (
          <div key={w.id ?? `n${i}`} className="vocab-row">
            <input aria-label="Word or phrase" placeholder="Word or phrase" value={w.term} onChange={(e) => set(i, { term: e.target.value })} />
            <input aria-label="Part of speech" placeholder="noun, verb…" value={w.partOfSpeech ?? ''} onChange={(e) => set(i, { partOfSpeech: e.target.value })} />
            <input aria-label="Meaning" placeholder="Meaning in simple English" value={w.meaning ?? ''} onChange={(e) => set(i, { meaning: e.target.value })} />
            <input aria-label="Example" placeholder="Example sentence" value={w.example ?? ''} onChange={(e) => set(i, { example: e.target.value })} />
            <button className="btn quiet" style={{ color: 'var(--alert)' }} onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
      </div>
      {items.length === 0 && <p className="muted">No vocabulary yet.</p>}
      <button className="btn primary" style={{ justifySelf: 'start' }} disabled={!dirty || busy} onClick={save}>Save vocabulary</button>
      {node}
    </section>
  );
}
