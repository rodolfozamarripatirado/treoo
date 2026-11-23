import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, type Exercise, type Group, type Person } from '../api';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad, useSession } from '../session';

interface GroupDetailData extends Omit<Group, 'teacherName' | 'studentCount'> { students: { id: string; displayName: string; email: string }[]; canManage: boolean }
interface AssignmentRow { id: string; prompt: string; type: Exercise['type']; topic: string | null; dueOn: string | null; submitted: number; pendingReview: number; points: number }
interface Attempts { exercise: Exercise; attempts: { id: string; studentName: string; answer: unknown; autoScore: number | null; teacherScore: number | null; feedback: string | null; createdAt: string }[] }
interface GroupProgress { students: { id: string; displayName: string; present: number; late: number; absent: number; excused: number; avgScore: number | null }[]; topics: { topic: string; classes: number; answers: number; avgScore: number | null; pendingReview: number }[] }

export function Groups() {
  const { me } = useSession();
  const isAdmin = me?.active?.role === 'admin';
  const groups = useLoad(() => api<Group[]>('/groups'), []);
  const teachers = useLoad(() => (isAdmin ? api<Person[]>('/people') : Promise.resolve([])), [isAdmin]);
  const [form, setForm] = useState({ name: '', level: '', schedule: '', teacherId: '' });
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setErr(null);
    try { await api('/groups', { body: { ...form, teacherId: form.teacherId || null } }); setForm({ name: '', level: '', schedule: '', teacherId: '' }); groups.reload(); }
    catch (e) { setErr((e as Error).message); }
  };
  const visible = (groups.data ?? []).filter((g) => isAdmin || g.teacherId === me?.user.id);
  return (
    <>
      <div className="page-head"><div><h1>Groups</h1><p className="muted">{isAdmin ? 'Create groups, assign a teacher and enrol students.' : 'The groups you teach.'}</p></div></div>
      {isAdmin && (
        <section className="sheet stack" style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>New group</h2>
          <ErrorNote msg={err} />
          <div className="grid-2">
            <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. B2 Evening" /></label>
            <label className="field">Level<input value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} /></label>
            <label className="field">Schedule<input value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} placeholder="e.g. Tue/Thu 18:00–20:00" /></label>
            <label className="field">Teacher<select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}><option value="">Not assigned</option>{(teachers.data ?? []).filter((p) => p.role !== 'student').map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>
          </div>
          <button className="btn primary" style={{ justifySelf: 'start' }} disabled={!form.name.trim()} onClick={create}>Create group</button>
        </section>
      )}
      {!groups.data ? <Loading /> : visible.length === 0 ? <div className="empty"><p>{isAdmin ? 'No groups yet. Create the first one above.' : 'You are not assigned to any group yet.'}</p></div> : (
        <ul className="list">
          {visible.map((g) => (
            <li key={g.id}><Link className="list-link" to={`/groups/${g.id}`}>
              <strong>{g.name}</strong><span className="pill">{g.level ?? 'No level'}</span>
              <span className="muted small">{[g.schedule, g.teacherName ?? 'No teacher'].filter(Boolean).join(', ')}</span>
              <span className="muted small">{g.studentCount} students</span>
            </Link></li>
          ))}
        </ul>
      )}
    </>
  );
}

export function GroupDetail() {
  const { id } = useParams();
  const { me } = useSession();
  const isAdmin = me?.active?.role === 'admin';
  const { toast, node } = useToast();
  const g = useLoad(() => api<GroupDetailData>(`/groups/${id}`), [id]);
  const students = useLoad(() => (isAdmin ? api<Person[]>('/people?role=student') : Promise.resolve([])), [isAdmin]);
  const canManage = g.data?.canManage;
  const assigns = useLoad(() => (canManage ? api<AssignmentRow[]>(`/assignments?groupId=${id}`) : Promise.resolve([])), [id, canManage]);
  const progress = useLoad(() => (canManage ? api<GroupProgress>(`/progress/group?groupId=${id}`) : Promise.resolve(null)), [id, canManage]);
  const coverage = useLoad(() => (canManage ? api<{ level: string | null; taught: number; total: number; units: { id: string; title: string; topics: { id: string; title: string; objective: string | null; taught: { lastTaught: string; classes: number } | null }[] }[] }>(`/curriculum/coverage?groupId=${id}`) : Promise.resolve(null)), [id, canManage]);
  const sites = useLoad(() => (isAdmin ? api<{ id: string; name: string }[]>('/academy/sites') : Promise.resolve([])), [isAdmin]);
  const [add, setAdd] = useState('');
  const [sp] = useSearchParams();
  const [open, setOpen] = useState<string | null>(sp.get('open'));
  const [err, setErr] = useState<string | null>(null);

  if (g.error) return <ErrorNote msg={g.error} />;
  if (!g.data) return <Loading />;
  const enrolled = new Set(g.data.students.map((s) => s.id));
  const act = async (fn: () => Promise<unknown>, done: string) => { setErr(null); try { await fn(); toast(done); g.reload(); progress.reload(); } catch (e) { setErr((e as Error).message); } };

  return (
    <>
      <Link className="back" to="/groups">Back to groups</Link>
      <div className="page-head"><div><h1>{g.data.name}</h1><p className="muted">{[g.data.level, g.data.schedule].filter(Boolean).join(', ')}</p></div>
        {isAdmin && (sites.data ?? []).length > 0 && <label className="field" style={{ width: 220 }}>Site<select value={(g.data as { siteId?: string | null }).siteId ?? ''} onChange={(e) => act(() => api(`/academy/groups/${id}/site`, { method: 'PUT', body: { siteId: e.target.value || null } }), 'Site updated')}><option value="">No site</option>{sites.data!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      </div>
      <ErrorNote msg={err} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Students</h2>
          {g.data.students.length === 0 && <p className="muted">No students enrolled yet.</p>}
          {g.data.students.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span><Link to={`/students/${s.id}`}>{s.displayName}</Link> <span className="muted small">{s.email}</span></span>
              {isAdmin && <button className="btn quiet" onClick={() => act(() => api(`/groups/${id}/students/${s.id}`, { method: 'DELETE' }), 'Student removed')}>Remove</button>}
            </div>
          ))}
          {isAdmin && (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select aria-label="Student to enrol" value={add} onChange={(e) => setAdd(e.target.value)}><option value="">Choose a student</option>{(students.data ?? []).filter((s) => !enrolled.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select>
              <button className="btn" disabled={!add} onClick={() => act(async () => { await api(`/groups/${id}/students`, { body: { studentId: add } }); setAdd(''); }, 'Student enrolled')}>Enrol</button>
            </div>
          )}
        </section>

        {progress.data && (
          <section className="sheet stack">
            <h2 style={{ margin: 0 }}>Progress by topic</h2>
            {progress.data.topics.length === 0 ? <p className="muted">No tasks assigned yet.</p> : (
              <div className="table-wrap"><table className="data"><thead><tr><th>Topic</th><th>Classes</th><th>Average</th><th>To mark</th></tr></thead><tbody>
                {progress.data.topics.map((t) => <tr key={t.topic}><td>{t.topic}</td><td>{t.classes}</td><td>{t.avgScore == null ? '—' : `${t.avgScore}%`}</td><td>{t.pendingReview}</td></tr>)}
              </tbody></table></div>
            )}
            <p className="muted small">Averages use each student’s latest answer. They show evidence collected in Treoo, not official grades.</p>
          </section>
        )}
      </div>

      {coverage.data && coverage.data.total > 0 && (
        <section className="sheet stack" style={{ marginTop: 20 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Curriculum coverage, {coverage.data.level}</h2><span className="pill ready">{coverage.data.taught} of {coverage.data.total} topics taught</span></div>
          <div className="meter"><span style={{ width: `${(100 * coverage.data.taught) / coverage.data.total}%` }} /></div>
          {coverage.data.units.map((u) => (
            <div key={u.id}><h3 style={{ margin: '10px 0 4px' }}>{u.title}</h3>
              {u.topics.map((t) => <div key={t.id} className={`coverage-topic ${t.taught ? 'done' : ''}`}><span><strong>{t.title}</strong>{t.objective && <span className="muted small"> {t.objective}</span>}</span><span className="muted small">{t.taught ? `last taught ${fmtDate(t.taught.lastTaught)}` : 'not yet'}</span></div>)}
            </div>
          ))}
          <p className="muted small" style={{ margin: 0 }}>A topic counts as taught when a class marked as taught used a lesson linked to it.</p>
        </section>
      )}

      {progress.data && progress.data.students.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h2>Attendance and results</h2>
          <div className="table-wrap"><table className="data"><thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Average</th></tr></thead><tbody>
            {progress.data.students.map((s) => <tr key={s.id}><td><Link to={`/students/${s.id}`}>{s.displayName}</Link></td><td>{s.present}</td><td>{s.late}</td><td>{s.absent}</td><td>{s.excused}</td><td>{s.avgScore == null ? '—' : `${s.avgScore}%`}</td></tr>)}
          </tbody></table></div>
        </section>
      )}

      {canManage && (
        <section style={{ marginTop: 20 }}>
          <h2>Tasks and answers</h2>
          {(assigns.data ?? []).length === 0 ? <p className="muted">Assign exercises from a class to collect answers here.</p> : (
            <ul className="list">
              {assigns.data!.map((a) => (
                <li key={a.id} style={{ padding: '12px 18px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div><strong>{a.prompt}</strong><div className="muted small">{[a.topic, a.dueOn ? `due ${fmtDate(a.dueOn)}` : null, `${a.submitted} answered`].filter(Boolean).join(', ')}</div></div>
                    <span className="row">{a.pendingReview > 0 && <span className="pill draft">{a.pendingReview} to mark</span>}<button className="btn quiet" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide answers' : 'See answers'}</button></span>
                  </div>
                  {open === a.id && <AttemptReview assignmentId={a.id} onChange={() => { assigns.reload(); progress.reload(); }} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {node}
    </>
  );
}

function AttemptReview({ assignmentId, onChange }: { assignmentId: string; onChange: () => void }) {
  const d = useLoad(() => api<Attempts>(`/assignments/${assignmentId}/attempts`), [assignmentId]);
  const [edit, setEdit] = useState<Record<string, { score: string; feedback: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  if (!d.data) return <Loading />;
  const ex = d.data.exercise;
  const show = (a: unknown) => ex.type === 'single_choice' ? ex.options?.[a as number] ?? String(a) : ex.type === 'true_false' ? (a ? 'True' : 'False') : String(a);
  if (d.data.attempts.length === 0) return <p className="muted" style={{ marginTop: 10 }}>No answers yet.</p>;
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <ErrorNote msg={err} />
      {d.data.attempts.map((t) => {
        const e = edit[t.id] ?? { score: t.teacherScore?.toString() ?? t.autoScore?.toString() ?? '', feedback: t.feedback ?? '' };
        return (
          <div key={t.id} className="sheet stack" style={{ padding: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><strong>{t.studentName}</strong><span className="muted small">{fmtDate(t.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{t.autoScore != null ? `, auto-marked ${t.autoScore}/${ex.points}` : ''}</span></div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{show(t.answer)}</p>
            <div className="row" style={{ alignItems: 'end' }}>
              <label className="field" style={{ width: 120 }}>Score / {ex.points}<input inputMode="decimal" value={e.score} onChange={(x) => setEdit({ ...edit, [t.id]: { ...e, score: x.target.value } })} /></label>
              <label className="field" style={{ flex: 1, minWidth: 200 }}>Feedback<input value={e.feedback} onChange={(x) => setEdit({ ...edit, [t.id]: { ...e, feedback: x.target.value } })} /></label>
              <button className="btn" onClick={async () => {
                setErr(null);
                try { await api(`/attempts/${t.id}/review`, { method: 'PUT', body: { teacherScore: e.score.trim() === '' ? null : Number(e.score.replace(',', '.')), feedback: e.feedback } }); d.reload(); onChange(); }
                catch (x) { setErr((x as Error).message); }
              }}>Save mark</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
