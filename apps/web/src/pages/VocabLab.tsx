import { useMemo, useState } from 'react';
import { api } from '../api';
import { ErrorNote, Loading } from '../components/ui';
import { useLoad } from '../session';

interface Card { id: string; term: string; partOfSpeech: string | null; meaning: string | null; example: string | null; lessonTitle: string; topic: string | null; box: number; due: boolean }

const Boxes = ({ n }: { n: number }) => <span className="boxes" aria-label={`Strength ${n} of 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</span>;

/** Vocabulary Lab: words from published classes, reviewed with spaced repetition (Leitner boxes). */
export function VocabLab() {
  const { data, error, setData } = useLoad(() => api<Card[]>('/portal/vocab'), []);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const queue = useMemo(() => (data ?? []).filter((c) => c.due), [data]);
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  const card = queue[0];

  const answer = async (result: 'known' | 'again') => {
    if (!card) return;
    setErr(null);
    try {
      const r = await api<{ box: number }>(`/portal/vocab/${card.id}/review`, { body: { result } });
      setData(data.map((c) => (c.id === card.id ? { ...c, box: r.box, due: false } : c)));
      setDone(done + 1); setFlipped(false);
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Vocabulary Lab</h1><p className="muted">Words from your classes. Words you know come back less often.</p></div></div>
      <ErrorNote msg={err} />
      {data.length === 0 ? <div className="empty"><p>No vocabulary yet. Words appear here when your teacher publishes a class with key vocabulary.</p></div> : (
        <section className="stack" style={{ maxWidth: 620, marginBottom: 28 }}>
          {card ? (<>
            <p className="muted" style={{ margin: 0 }}>{queue.length} {queue.length === 1 ? 'word' : 'words'} to review{done ? `, ${done} done` : ''}</p>
            <button className="flashcard" onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Hide meaning' : 'Show meaning'}>
              <div>
                <div className="term">{card.term}</div>
                {card.partOfSpeech && <div className="small" style={{ opacity: .7 }}>{card.partOfSpeech}</div>}
                {flipped ? (<>{card.meaning && <div className="meaning">{card.meaning}</div>}{card.example && <div className="example">{card.example}</div>}</>)
                  : <div className="small" style={{ marginTop: 14, opacity: .7 }}>Do you know it? Tap to check.</div>}
              </div>
            </button>
            <div className="row">
              <button className="btn primary" onClick={() => answer('known')}>I knew it</button>
              <button className="btn" onClick={() => answer('again')}>Not yet</button>
            </div>
          </>) : <div className="notice info"><p>All done for today. Come back tomorrow for the next review.</p></div>}
        </section>
      )}
      {data.length > 0 && (<>
        <h2>All my words</h2>
        <div className="word-list">
          {data.map((c) => <div key={c.id}><div className="row" style={{ justifyContent: 'space-between' }}><strong>{c.term}</strong><Boxes n={c.box} /></div><div className="small">{c.meaning}</div><div className="muted small">{c.lessonTitle}</div></div>)}
        </div>
      </>)}
    </>
  );
}
