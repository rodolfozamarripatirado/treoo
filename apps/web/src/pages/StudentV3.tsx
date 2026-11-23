import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, today } from '../api';
import { AssessmentList, type Assessment } from '../components/Assessments';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad } from '../session';
import { KIND_LABEL, agenda, type CalEvent } from './Calendar';

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function MyCalendar() {
  const from = addDays(today(), -7); const to = addDays(today(), 56);
  const { data, error, reload } = useLoad(() => api<{ classes: { id: string; scheduledOn: string; startTime: string | null; endTime: string | null; status: string; cancelledReason: string | null; topic: string | null; groupName: string; published: boolean }[]; due: { id: string; dueOn: string; prompt: string }[]; events: CalEvent[] }>(`/portal/calendar?from=${from}&to=${to}`), []);
  const [err, setErr] = useState<string | null>(null);
  const { toast, node } = useToast();
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  const items = [
    ...data.classes.map((c) => ({ date: c.scheduledOn.slice(0, 10), c })),
    ...data.due.map((d) => ({ date: d.dueOn.slice(0, 10), d })),
    ...data.events.map((e) => ({ date: e.startsOn, e })),
  ];
  const toggle = async (e: CalEvent) => {
    setErr(null);
    try { await api(`/portal/events/${e.id}/signup`, { method: e.signedUp ? 'DELETE' : 'POST' }); toast(e.signedUp ? 'Signup cancelled' : 'You are signed up'); reload(); }
    catch (x) { setErr((x as Error).message); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Calendar</h1><p className="muted">Your classes, task deadlines, holidays and academy events.</p></div></div>
      <ErrorNote msg={err} />
      {items.length === 0 ? <p className="muted">Nothing coming up.</p> : agenda(items).map(([date, list]) => (
        <section key={date}>
          <h2 className="day-head">{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}{date === today() ? ' — today' : ''}</h2>
          <ul className="list">{list.map((it, i) => (
            <li key={i}>
              {'c' in it && it.c && it.c.status === 'cancelled' ? <div className="list-link"><strong>{it.c.groupName}</strong><span className="pill absent">Cancelled</span><span className="muted small">{it.c.cancelledReason}</span></div>
                : 'c' in it && it.c && (it.c.published ? <Link className="list-link" to={`/me/classes/${it.c.id}`}><strong>{it.c.startTime ? `${it.c.startTime.slice(0, 5)} ` : ''}{it.c.groupName}</strong><span className="pill">Class</span><span className="muted small">{it.c.topic}</span></Link>
                : <div className="list-link"><strong>{it.c.startTime ? `${it.c.startTime.slice(0, 5)} ` : ''}{it.c.groupName}</strong><span className="pill">Class</span><span className="muted small">{it.c.topic ?? ''}</span></div>)}
              {'d' in it && it.d && <Link className="list-link" to="/me/tasks"><strong>Task due</strong><span className="pill draft">Deadline</span><span className="muted small">{it.d.prompt}</span></Link>}
              {'e' in it && it.e && (
                <div className="list-link">
                  <strong>{it.e.title}</strong><span className={`pill ${it.e.kind === 'holiday' ? 'absent' : it.e.kind === 'exam' ? 'draft' : 'ready'}`}>{KIND_LABEL[it.e.kind]}</span>
                  <span className="muted small">{[it.e.description, it.e.endsOn !== it.e.startsOn ? `until ${fmtDate(it.e.endsOn)}` : null, it.e.siteName, it.e.signupOpen && it.e.capacity ? `${Math.max(0, it.e.capacity - it.e.signups)} places left` : null].filter(Boolean).join(', ')}</span>
                  {it.e.signupOpen && <button className={`btn ${it.e.signedUp ? '' : 'primary'}`} style={{ gridColumn: '1 / -1', justifySelf: 'start' }} onClick={() => toggle(it.e!)}>{it.e.signedUp ? 'Cancel signup' : 'Sign up'}</button>}
                </div>
              )}
            </li>
          ))}</ul>
        </section>
      ))}
      {node}
    </>
  );
}

interface ReviewItem { assignmentId: string; type: string; prompt: string; options: string[] | null; correctAnswer: unknown; points: number; topic: string | null; answer: unknown; score: number; feedback: string | null }

/** Review Centre: practise again what went wrong. Practice here is self-checked and does not change marks. */
export function ReviewMistakes() {
  const { data, error } = useLoad(() => api<ReviewItem[]>('/portal/review'), []);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <div className="empty"><p>No mistakes to review. Tasks where your answer was not fully right will appear here.</p></div>;
  const show = (r: ReviewItem, v: unknown) => r.type === 'single_choice' ? r.options?.[v as number] : r.type === 'true_false' ? (v ? 'True' : 'False') : r.type === 'gap_fill' ? (v as string[][] | string[]).map((x) => (Array.isArray(x) ? x.join(' / ') : x)).join(', ') : String(v ?? '');
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Try to remember the right answer before you reveal it. Practising here does not change your marks.</p>
      {data.map((r) => (
        <article key={r.assignmentId} className="sheet stack">
          <div className="muted small">{r.topic ?? 'General'}, you scored {r.score}/{r.points}</div>
          <h3 style={{ margin: 0 }}>{r.prompt}</h3>
          <p style={{ margin: 0 }}>Your answer: <strong>{show(r, r.answer)}</strong></p>
          {open[r.assignmentId] ? (<div className="notice info"><p>Correct answer: <strong>{r.correctAnswer == null ? 'see your teacher’s feedback' : show(r, r.correctAnswer)}</strong></p>{r.feedback && <p style={{ marginTop: 6 }}>Teacher: {r.feedback}</p>}</div>)
            : <button className="btn" style={{ justifySelf: 'start' }} onClick={() => setOpen({ ...open, [r.assignmentId]: true })}>Show the answer</button>}
        </article>
      ))}
    </div>
  );
}

export function Library() {
  const { data, error } = useLoad(() => api<{ id: string; title: string; source: string | null; text: string | null; hasOriginal: boolean; sessionId: string; scheduledOn: string; topic: string | null; groupName: string }[]>('/portal/library'), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <div className="empty"><p>No material shared yet. Worksheets your teacher shares with a class appear here.</p></div>;
  return (
    <div className="stack">
      {data.map((m) => (
        <article key={m.id} className="sheet stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><div><strong>{m.title}</strong><div className="muted small">{[m.topic, fmtDate(m.scheduledOn), m.source].filter(Boolean).join(', ')}</div></div>
            <button className="btn quiet" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? 'Close' : 'Open'}</button></div>
          {open === m.id && (<>
            {m.hasOriginal && <img src={`/api/portal/materials/${m.id}/original`} alt={`Original of ${m.title}`} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--rule)' }} />}
            {m.text && <div className="source-text">{m.text}</div>}
          </>)}
        </article>
      ))}
    </div>
  );
}

export function GoalsAndAssessments() {
  const goals = useLoad(() => api<{ id: string; text: string; targetDate: string | null; doneAt: string | null }[]>('/portal/goals'), []);
  const assessments = useLoad(() => api<Assessment[]>('/assessments/mine'), []);
  const [text, setText] = useState(''); const [date, setDate] = useState('');
  return (
    <>
      <section className="sheet stack" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>My goals</h2>
        {(goals.data ?? []).map((g) => (
          <div key={g.id} className="row" style={{ justifyContent: 'space-between' }}>
            <label className="check"><input type="checkbox" checked={!!g.doneAt} onChange={async () => { await api(`/portal/goals/${g.id}`, { method: 'PUT', body: { done: !g.doneAt } }); goals.reload(); }} />
              <span style={{ textDecoration: g.doneAt ? 'line-through' : undefined }}>{g.text}{g.targetDate && <span className="muted small"> by {fmtDate(g.targetDate)}</span>}</span></label>
            <button className="btn quiet" onClick={async () => { await api(`/portal/goals/${g.id}`, { method: 'DELETE' }); goals.reload(); }}>Remove</button>
          </div>
        ))}
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>New goal<input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Watch one film a week in English" /></label>
          <label className="field" style={{ width: 170 }}>By<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <button className="btn" disabled={!text.trim()} onClick={async () => { await api('/portal/goals', { body: { text, targetDate: date || null } }); setText(''); setDate(''); goals.reload(); }}>Add goal</button>
        </div>
      </section>
      <h2 style={{ marginTop: 24 }}>Assessments</h2>
      <p className="muted small">CEFR levels here are estimates from your academy’s assessments, not official certificates.</p>
      {assessments.data ? <AssessmentList items={assessments.data} /> : <Loading />}
    </>
  );
}
