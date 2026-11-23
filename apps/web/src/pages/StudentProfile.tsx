import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { ErrorNote, Loading, StatusPill } from '../components/ui';
import { useLoad, useSession } from '../session';

interface Profile {
  student: { id: string; displayName: string; email: string };
  groups: { id: string; name: string; level: string | null }[];
  attendance: { sessionId: string; scheduledOn: string; topic: string | null; groupName: string; status: string | null }[];
  topics: { topic: string; tasks: number; avgScore: number | null; pendingReview: number }[];
  recent: { id: string; createdAt: string; prompt: string; type: string; options: string[] | null; answer: unknown; autoScore: number | null; teacherScore: number | null; points: number; feedback: string | null }[];
  vocab: { reviewed: number; strong: number };
  notes: { id: string; body: string; createdAt: string; authorId: string; authorName: string }[];
}

export function StudentProfile() {
  const { id } = useParams();
  const { me } = useSession();
  const { data, error, reload } = useLoad(() => api<Profile>(`/students/${id}`), [id]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  const taken = data.attendance.filter((a) => a.status);
  const attended = taken.filter((a) => a.status === 'present' || a.status === 'late').length;
  const show = (r: Profile['recent'][number]) => r.type === 'single_choice' ? r.options?.[r.answer as number] : r.type === 'true_false' ? (r.answer ? 'True' : 'False') : String(r.answer);

  return (
    <>
      <Link className="back" to="/today">Back to Today</Link>
      <div className="page-head"><div><h1>{data.student.displayName}</h1><p className="muted">{data.groups.map((g) => g.name).join(', ')}</p></div></div>
      <div className="today-grid">
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Attendance</h2>
          <p style={{ fontFamily: 'var(--display)', fontSize: '2rem', margin: 0 }}>{taken.length ? `${attended} of ${taken.length}` : '—'}</p>
          <div className="row">{data.attendance.slice(0, 12).map((a) => <span key={a.sessionId} title={`${fmtDate(a.scheduledOn)}, ${a.topic ?? ''}`}><StatusPill status={a.status ?? 'not taken'} /></span>)}</div>
        </section>
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>By topic</h2>
          {data.topics.length === 0 ? <p className="muted">No answers yet.</p> : data.topics.map((t) => (
            <div key={t.topic} className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><strong>{t.topic}</strong><span className="muted small">{t.tasks} tasks{t.avgScore != null ? `, ${t.avgScore}%` : ''}{t.pendingReview ? `, ${t.pendingReview} to mark` : ''}</span></div>
              <div className="meter"><span style={{ width: `${t.avgScore ?? 0}%` }} /></div>
            </div>
          ))}
          <p className="muted small" style={{ margin: 0 }}>Vocabulary: {data.vocab.reviewed} words reviewed, {data.vocab.strong} well known.</p>
        </section>
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Private notes</h2>
          <p className="muted small" style={{ margin: 0 }}>Visible to teachers and admins of this academy. Never shown to the student.</p>
          <ErrorNote msg={err} />
          <label className="field"><span className="sr-only">New note</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confident speaker, needs work on irregular verbs" /></label>
          <button className="btn" style={{ justifySelf: 'start' }} disabled={!note.trim()} onClick={async () => { setErr(null); try { await api(`/students/${id}/notes`, { body: { body: note } }); setNote(''); reload(); } catch (e) { setErr((e as Error).message); } }}>Add note</button>
          {data.notes.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
              <div className="muted small">{n.authorName}, {fmtDate(n.createdAt)}{n.authorId === me?.user.id && <button className="btn quiet" onClick={async () => { await api(`/students/${id}/notes/${n.id}`, { method: 'DELETE' }); reload(); }}>Delete</button>}</div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.body}</p>
            </div>
          ))}
        </section>
      </div>
      <h2 style={{ marginTop: 24 }}>Recent answers</h2>
      {data.recent.length === 0 ? <p className="muted">No answers yet.</p> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>Question</th><th>Answer</th><th>Score</th><th>Feedback</th></tr></thead><tbody>
          {data.recent.map((r) => <tr key={r.id}><td>{r.prompt}</td><td>{show(r)}</td><td>{(r.teacherScore ?? r.autoScore) == null ? <span className="pill draft">To mark</span> : `${r.teacherScore ?? r.autoScore}/${r.points}`}</td><td>{r.feedback ?? '—'}</td></tr>)}
        </tbody></table></div>
      )}
    </>
  );
}
