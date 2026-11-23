import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, type Exercise } from '../api';
import { ErrorNote, Loading, RouteBar, StatusPill } from '../components/ui';
import { useLoad } from '../session';

interface DiaryRow { id: string; scheduledOn: string; topic: string; groupName: string; lessonTitle: string | null; objective: string | null; level: string | null; sharedNotes: string | null; hasBoard: boolean; myAttendance: string | null }
interface Task {
  id: string; dueOn: string | null; groupName: string; sessionDate: string | null; sessionId: string | null; attemptsLeft: number;
  exercise: Pick<Exercise, 'type' | 'prompt' | 'options' | 'points' | 'topic'> & { correctAnswer?: Exercise['correctAnswer'] };
  attempts: { id: string; answer: unknown; autoScore: number | null; teacherScore: number | null; feedback: string | null; createdAt: string }[];
}

/** My Classes: the same published classes, found by day or by topic. */
export function MyClasses() {
  const { data, error } = useLoad(() => api<DiaryRow[]>('/portal/diary'), []);
  const [view, setView] = useState<'date' | 'topic'>('date');
  const groups = useMemo(() => {
    const m = new Map<string, DiaryRow[]>();
    for (const r of data ?? []) {
      const k = view === 'date' ? r.scheduledOn.slice(0, 7) : r.topic;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    const entries = [...m.entries()];
    return view === 'topic' ? entries.sort(([a], [b]) => a.localeCompare(b)) : entries;
  }, [data, view]);

  return (
    <>
      <div className="page-head"><div><h1>My classes</h1><p className="muted">Everything your teachers published, by day or by topic.</p></div></div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'date'} onClick={() => setView('date')}>By date</button>
        <button role="tab" aria-selected={view === 'topic'} onClick={() => setView('topic')}>By topic</button>
      </div>
      <ErrorNote msg={error} />
      {!data ? <Loading /> : data.length === 0 ? <div className="empty"><p>No classes published yet. When your teacher publishes a class, it appears here.</p></div> : groups.map(([k, rows]) => (
        <section key={k}>
          <h2 className="day-head">{view === 'date' ? fmtDate(`${k}-15`, { month: 'long', year: 'numeric' }) : k}</h2>
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id}><Link className="list-link" to={`/me/classes/${r.id}`}>
                <strong>{view === 'date' ? `${fmtDate(r.scheduledOn)}, ${r.topic}` : `${r.lessonTitle ?? r.topic}`}</strong>
                {r.myAttendance ? <StatusPill status={r.myAttendance} /> : <span />}
                <span className="muted small">{view === 'date' ? (r.lessonTitle ?? r.groupName) : `${fmtDate(r.scheduledOn)}, ${r.groupName}`}</span>
              </Link></li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function MyClass() {
  const { id } = useParams();
  const { data, error } = useLoad(() => api<DiaryRow & { activities: { title: string | null; kind: string | null; instructions: string | null; durationMinutes: number | null }[]; assignments: { id: string; prompt: string; dueOn: string | null }[]; vocab: { id: string; term: string; meaning: string | null; example: string | null }[] }>(`/portal/sessions/${id}`), [id]);
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <Link className="back" to="/me">Back to my classes</Link>
      <div className="page-head"><div><h1>{data.lessonTitle ?? data.topic}</h1><p className="muted">{fmtDate(data.scheduledOn, { weekday: 'long', day: 'numeric', month: 'long' })}, {data.groupName}</p></div>{data.myAttendance && <StatusPill status={data.myAttendance} />}</div>
      {data.objective && <p><strong>Goal:</strong> {data.objective}</p>}
      {data.sharedNotes && <section className="sheet" style={{ marginBottom: 16 }}><h2>Notes from your teacher</h2><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{data.sharedNotes}</p></section>}
      {data.activities.length > 0 && (
        <section className="stack" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>What we did</h2>
          <RouteBar activities={data.activities} showMeta={false} />
          <ol className="stops">{data.activities.map((a, i) => <li className="stop" key={i}><div className="stop-card"><strong>{a.title}</strong>{a.instructions && <p style={{ margin: 0 }}>{a.instructions}</p>}</div></li>)}</ol>
        </section>
      )}
      {data.vocab.length > 0 && <section className="sheet stack" style={{ marginBottom: 16 }}><h2 style={{ margin: 0 }}>Key vocabulary</h2><div className="word-list">{data.vocab.map((w) => <div key={w.id}><strong>{w.term}</strong><div className="small">{w.meaning}</div>{w.example && <div className="muted small"><em>{w.example}</em></div>}</div>)}</div><Link className="btn" style={{ justifySelf: 'start' }} to="/me/vocab">Practise in Vocabulary Lab</Link></section>}
      {data.hasBoard && <section className="sheet" style={{ marginBottom: 16 }}><h2>Board</h2><img src={`/api/sessions/${data.id}/board`} alt="Board from class" style={{ maxWidth: '100%', borderRadius: 8 }} /></section>}
      {data.assignments.length > 0 && <section className="sheet"><h2>Tasks</h2><ul>{data.assignments.map((a) => <li key={a.id}>{a.prompt}{a.dueOn ? ` (due ${fmtDate(a.dueOn)})` : ''}</li>)}</ul><Link className="btn primary" to="/me/tasks">Go to my tasks</Link></section>}
    </>
  );
}

export function MyTasks() {
  const { data, error, reload } = useLoad(() => api<Task[]>('/portal/assignments'), []);
  const pending = (data ?? []).filter((t) => t.attempts.length === 0);
  const done = (data ?? []).filter((t) => t.attempts.length > 0);
  return (
    <>
      <div className="page-head"><div><h1>Tasks</h1><p className="muted">Answer at your own pace. You have up to 3 attempts per task.</p></div></div>
      <ErrorNote msg={error} />
      {!data ? <Loading /> : (
        <>
          <h2>To do</h2>
          {pending.length === 0 ? <p className="muted">Nothing pending. Well done.</p> : <div className="stack">{pending.map((t) => <TaskCard key={t.id} t={t} onDone={reload} />)}</div>}
          <h2 style={{ marginTop: 28 }}>Answered</h2>
          {done.length === 0 ? <p className="muted">Your answered tasks and feedback appear here.</p> : <div className="stack">{done.map((t) => <TaskCard key={t.id} t={t} onDone={reload} />)}</div>}
        </>
      )}
    </>
  );
}

function TaskCard({ t, onDone }: { t: Task; onDone: () => void }) {
  const [answer, setAnswer] = useState<number | boolean | string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ex = t.exercise;
  const latest = t.attempts[0];
  const score = latest ? latest.teacherScore ?? latest.autoScore : null;
  const send = async () => {
    setBusy(true); setErr(null);
    try { await api(`/portal/assignments/${t.id}/attempts`, { body: { answer } }); setAnswer(null); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const show = (a: unknown) => ex.type === 'single_choice' ? ex.options?.[a as number] : ex.type === 'true_false' ? (a ? 'True' : 'False') : String(a);
  return (
    <article className="sheet stack">
      <div className="muted small">{[ex.topic, t.groupName, t.dueOn ? `due ${fmtDate(t.dueOn)}` : null].filter(Boolean).join(', ')}</div>
      <h3 style={{ margin: 0 }}>{ex.prompt}</h3>
      {latest && (
        <div className={`notice ${score == null ? 'warn' : score >= ex.points ? 'info' : 'warn'}`}>
          <p>Your answer: <strong>{show(latest.answer)}</strong>. {score == null ? 'Waiting for your teacher to mark it.' : `Score ${score}/${ex.points}.`}</p>
          {latest.feedback && <p style={{ marginTop: 6 }}>Teacher: {latest.feedback}</p>}
        </div>
      )}
      {t.attemptsLeft > 0 && (
        <>
          {ex.type === 'single_choice' && <div className="choices" role="radiogroup">{ex.options?.map((o, i) => (
            <label key={i} className={`choice ${latest && ex.correctAnswer === i ? 'correct' : ''}`}><input type="radio" name={t.id} checked={answer === i} onChange={() => setAnswer(i)} />{o}</label>
          ))}</div>}
          {ex.type === 'true_false' && <div className="choices" role="radiogroup">{[true, false].map((v) => (
            <label key={String(v)} className={`choice ${latest && ex.correctAnswer === v ? 'correct' : ''}`}><input type="radio" name={t.id} checked={answer === v} onChange={() => setAnswer(v)} />{v ? 'True' : 'False'}</label>
          ))}</div>}
          {ex.type === 'short_answer' && <label className="field"><span className="sr-only">Your answer</span><textarea rows={3} value={typeof answer === 'string' ? answer : ''} onChange={(e) => setAnswer(e.target.value)} /></label>}
          <ErrorNote msg={err} />
          <div className="row"><button className="btn primary" disabled={busy || answer === null || answer === ''} onClick={send}>{latest ? 'Try again' : 'Send answer'}</button><span className="muted small">{t.attemptsLeft} {t.attemptsLeft === 1 ? 'attempt' : 'attempts'} left</span></div>
        </>
      )}
    </article>
  );
}

export function MyProgress() {
  const { data, error } = useLoad(() => api<{ attendance: Record<string, number>; topics: { topic: string; tasks: number; pct: number | null }[] }>('/portal/progress'), []);
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  const total = Object.values(data.attendance).reduce((a, b) => a + b, 0);
  const attended = (data.attendance.present ?? 0) + (data.attendance.late ?? 0);
  return (
    <>
      <div className="page-head"><div><h1>My progress</h1><p className="muted">Based on attendance taken and the tasks you have answered.</p></div></div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Attendance</h2>
          {total === 0 ? <p className="muted">No attendance recorded yet.</p> : <>
            <p style={{ fontFamily: 'var(--display)', fontSize: '2.4rem', margin: 0 }}>{attended} of {total}</p>
            <p className="muted" style={{ margin: 0 }}>classes attended{data.attendance.late ? `, ${data.attendance.late} late` : ''}</p>
          </>}
        </section>
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>By topic</h2>
          {data.topics.length === 0 ? <p className="muted">Answer some tasks to see your results here.</p> : data.topics.map((t) => (
            <div key={t.topic} className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><strong>{t.topic}</strong><span className="muted small">{t.tasks} tasks{t.pct == null ? ', waiting for marks' : `, ${t.pct}%`}</span></div>
              <div className="meter"><span style={{ width: `${t.pct ?? 0}%` }} /></div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
