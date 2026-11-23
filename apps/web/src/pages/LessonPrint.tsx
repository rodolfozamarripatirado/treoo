import { useParams } from 'react-router-dom';
import { api, type Lesson } from '../api';
import { ErrorNote, Loading } from '../components/ui';
import type { Word } from '../components/Vocab';
import { useLoad } from '../session';
import { maskGaps, showGaps } from '../components/Exercises';

/** Printable student handout: vocabulary and exercises, with the answer key on a separate page. */
export function LessonPrint() {
  const { id } = useParams();
  const { data: l, error } = useLoad(() => api<Lesson & { vocab: Word[] }>(`/lessons/${id}`), [id]);
  if (error) return <ErrorNote msg={error} />;
  if (!l) return <Loading />;
  const ex = l.exercises ?? [];
  return (
    <>
      <div className="print-bar"><button className="btn primary" onClick={() => window.print()}>Print or save as PDF</button><a className="btn" href={`/lessons/${id}`}>Back to the lesson</a></div>
      <article className="print-page">
        <p className="small">Name: ________________________ &nbsp; Date: ____________</p>
        <h1>{l.title}</h1>
        {l.objective && <p><em>{l.objective}</em></p>}
        {l.vocab.length > 0 && (<>
          <h2>Key vocabulary</h2>
          <table className="data" style={{ fontSize: '11pt' }}><tbody>{l.vocab.map((w, i) => <tr key={i}><td><strong>{w.term}</strong>{w.partOfSpeech ? ` (${w.partOfSpeech})` : ''}</td><td>{w.meaning}</td><td><em>{w.example}</em></td></tr>)}</tbody></table>
        </>)}
        {ex.length > 0 && (<>
          <h2>Practice</h2>
          <ol>{ex.map((e) => (
            <li key={e.id} style={{ marginBottom: 14 }}>
              {e.type === 'gap_fill' ? maskGaps(e.prompt) : e.prompt}
              {e.type === 'single_choice' && <ol type="a">{e.options?.map((o, i) => <li key={i}>{o}</li>)}</ol>}
              {e.type === 'true_false' && <div>True / False</div>}
              {e.type === 'short_answer' && <><div className="lines" /><div className="lines" /></>}
            </li>
          ))}</ol>
          <section className="key">
            <h2>Answer key — {l.title}</h2>
            <ol>{ex.map((e) => <li key={e.id}>{e.type === 'single_choice' ? `${String.fromCharCode(97 + (e.correctAnswer as number))}) ${e.options?.[e.correctAnswer as number]}` : e.type === 'true_false' ? (e.correctAnswer ? 'True' : 'False') : e.type === 'gap_fill' ? showGaps(e.prompt) : (e.correctAnswer ? `Model answer: ${e.correctAnswer}` : 'Open answer')}</li>)}</ol>
          </section>
        </>)}
        {ex.length === 0 && l.vocab.length === 0 && <p>Add vocabulary or exercises to the lesson to build a handout.</p>}
      </article>
    </>
  );
}
