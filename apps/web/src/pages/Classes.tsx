import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, today, type Exercise, type Group, type Lesson } from '../api';
import { ErrorNote, Loading, RouteBar, StatusPill, useToast } from '../components/ui';
import { ExerciseSummary } from '../components/Exercises';
import { useLoad, useSession } from '../session';

interface SessionRow { id: string; scheduledOn: string; topic: string | null; status: 'planned' | 'delivered'; publishedAt: string | null; groupId: string; groupName: string; lessonId: string | null }
interface SessionDetail {
  id: string; scheduledOn: string; topic: string | null; status: 'planned' | 'delivered'; publishedAt: string | null; sharedNotes: string | null; privateNotes: string | null;
  hasBoard: boolean; shareBoard: number; group: Group; lesson: Lesson | null; roster: { id: string; displayName: string; status: Attendance | null }[]; exercises: Exercise[];
}
type Attendance = 'present' | 'absent' | 'late' | 'excused';
interface AssignmentRow { id: string; sessionId: string | null; prompt: string; dueOn: string | null; submitted: number; pendingReview: number }

export function Classes() {
  const { me } = useSession();
  const nav = useNavigate();
  const sessions = useLoad(() => api<SessionRow[]>('/sessions'), []);
  const groups = useLoad(() => api<Group[]>('/groups'), []);
  const lessons = useLoad(() => api<{ id: string; title: string; topic: string | null }[]>('/lessons'), []);
  const [form, setForm] = useState({ groupId: '', lessonId: '', scheduledOn: today() });
  const [err, setErr] = useState<string | null>(null);
  const myGroups = (groups.data ?? []).filter((g) => me?.active?.role === 'admin' || g.teacherId === me?.user.id);

  const schedule = async () => {
    setErr(null);
    try {
      const s = await api<{ id: string }>('/sessions', { body: { groupId: form.groupId, lessonId: form.lessonId || null, scheduledOn: form.scheduledOn } });
      nav(`/classes/${s.id}`);
    } catch (e) { setErr((e as Error).message); }
  };
  const t = today();
  const upcoming = (sessions.data ?? []).filter((s) => s.scheduledOn >= t).reverse();
  const past = (sessions.data ?? []).filter((s) => s.scheduledOn < t);

  return (
    <>
      <div className="page-head"><div><h1>Classes</h1><p className="muted">Plan a class with a lesson, teach it, take attendance and publish what students should keep.</p></div></div>
      <section className="sheet stack" style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Schedule a class</h2>
        <ErrorNote msg={err} />
        {myGroups.length === 0 && groups.data ? <p className="muted">You have no groups assigned yet. An admin can assign you to a group.</p> : (
          <div className="grid-2">
            <label className="field">Group<select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}><option value="">Choose a group</option>{myGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
            <label className="field">Lesson<select value={form.lessonId} onChange={(e) => setForm({ ...form, lessonId: e.target.value })}><option value="">No lesson yet</option>{(lessons.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
            <label className="field">Date<input type="date" value={form.scheduledOn} onChange={(e) => setForm({ ...form, scheduledOn: e.target.value })} /></label>
            <div style={{ alignSelf: 'end' }}><button className="btn primary" disabled={!form.groupId} onClick={schedule}>Schedule class</button></div>
          </div>
        )}
      </section>
      <ErrorNote msg={sessions.error} />
      {!sessions.data ? <Loading /> : (
        <>
          <h2>Today and upcoming</h2>
          <SessionList rows={upcoming} empty="Nothing scheduled. Schedule a class above." />
          <h2 style={{ marginTop: 28 }}>Past classes</h2>
          <SessionList rows={past} empty="No past classes yet." />
        </>
      )}
    </>
  );
}

function SessionList({ rows, empty }: { rows: SessionRow[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="list">
      {rows.map((s) => (
        <li key={s.id}>
          <Link className="list-link" to={`/classes/${s.id}`}>
            <strong>{fmtDate(s.scheduledOn)}, {s.groupName}</strong>
            <span className="row"><StatusPill status={s.status} />{s.publishedAt && <span className="pill published">Published</span>}</span>
            <span className="muted small">{s.topic ?? 'No topic yet'}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ClassDetail() {
  const { id } = useParams();
  const { toast, node } = useToast();
  const { data: s, error, reload } = useLoad(() => api<SessionDetail>(`/sessions/${id}`), [id]);
  const assigns = useLoad(() => (s ? api<AssignmentRow[]>(`/assignments?groupId=${s.group.id}`) : Promise.resolve([])), [s?.group.id]);
  const [att, setAtt] = useState<Record<string, Attendance>>({});
  const [notes, setNotes] = useState({ sharedNotes: '', privateNotes: '', shareBoard: false });
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [due, setDue] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!s) return;
    setAtt(Object.fromEntries(s.roster.filter((r) => r.status).map((r) => [r.id, r.status!])));
    setNotes({ sharedNotes: s.sharedNotes ?? '', privateNotes: s.privateNotes ?? '', shareBoard: !!s.shareBoard });
  }, [s]);

  if (error) return <ErrorNote msg={error} />;
  if (!s) return <Loading />;
  const act = async (fn: () => Promise<unknown>, done: string) => { setErr(null); try { await fn(); toast(done); reload(); } catch (e) { setErr((e as Error).message); } };
  const mine = (assigns.data ?? []).filter((a) => a.sessionId === s.id);

  return (
    <>
      <Link className="back" to="/classes">Back to classes</Link>
      <div className="page-head">
        <div><h1>{fmtDate(s.scheduledOn, { weekday: 'long', day: 'numeric', month: 'long' })}</h1><p className="muted">{s.group.name}{s.topic ? `, ${s.topic}` : ''}</p></div>
        <div className="row">
          <StatusPill status={s.status} />
          {s.lesson && <Link className="btn primary" to={`/classes/${s.id}/present`}>Teach in class mode</Link>}
        </div>
      </div>
      <ErrorNote msg={err} />

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Lesson</h2>
          {s.lesson ? (<><Link to={`/lessons/${s.lesson.id}`}><strong>{s.lesson.title}</strong></Link><RouteBar activities={s.lesson.activities} /></>) : <p className="muted">No lesson linked. Edit the class from the list to add one.</p>}
        </section>

        <section className="sheet stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Attendance</h2><button className="btn quiet" onClick={() => setAtt(Object.fromEntries(s.roster.map((r) => [r.id, 'present' as Attendance])))}>Mark all present</button></div>
          {s.roster.length === 0 && <p className="muted">No students in this group yet.</p>}
          {s.roster.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{r.displayName}</span>
              <select aria-label={`Attendance for ${r.displayName}`} style={{ width: 140 }} value={att[r.id] ?? ''} onChange={(e) => setAtt({ ...att, [r.id]: e.target.value as Attendance })}>
                <option value="">Not taken</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option><option value="excused">Excused</option>
              </select>
            </div>
          ))}
          {s.roster.length > 0 && <button className="btn" style={{ justifySelf: 'start' }} onClick={() => act(() => api(`/sessions/${s.id}/attendance`, { method: 'PUT', body: { records: Object.entries(att).map(([studentId, status]) => ({ studentId, status })) } }), 'Attendance saved')}>Save attendance</button>}
        </section>
      </div>

      <section className="sheet stack" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>What happened in class</h2>
        <label className="field">Notes for students <span className="hint">Shown in their diary once you publish.</span><textarea rows={3} value={notes.sharedNotes} onChange={(e) => setNotes({ ...notes, sharedNotes: e.target.value })} /></label>
        <label className="field">Private notes <span className="hint">Only you and academy admins see these.</span><textarea rows={2} value={notes.privateNotes} onChange={(e) => setNotes({ ...notes, privateNotes: e.target.value })} /></label>
        {s.hasBoard && (
          <div className="stack">
            <img src={`/api/sessions/${s.id}/board?v=${s.status}`} alt="Board from class mode" style={{ maxWidth: 420, background: '#11172b', borderRadius: 8 }} />
            <label className="check"><input type="checkbox" checked={notes.shareBoard} onChange={(e) => setNotes({ ...notes, shareBoard: e.target.checked })} />Share the board with students</label>
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={() => act(() => api(`/sessions/${s.id}/deliver`, { body: notes }), 'Class record saved')}>{s.status === 'delivered' ? 'Update class record' : 'Mark as taught'}</button>
          {s.publishedAt
            ? <><span className="pill published">Published {fmtDate(s.publishedAt)}</span><button className="btn quiet" onClick={() => act(() => api(`/sessions/${s.id}/unpublish`, { method: 'POST' }), 'Unpublished')}>Unpublish</button></>
            : <button className="btn primary" onClick={() => act(async () => { await api(`/sessions/${s.id}/deliver`, { body: notes }); await api(`/sessions/${s.id}/publish`, { method: 'POST' }); }, 'Published to students')}>Publish to students</button>}
        </div>
        <p className="muted small">Students see the date, topic, activities, your notes for students and assigned tasks. Private notes, teacher notes and answers are never published.</p>
      </section>

      <section className="sheet stack" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>Tasks for this class</h2>
        {mine.map((a) => <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}><span>{a.prompt}</span><span className="muted small">{a.submitted} answered{a.pendingReview ? `, ${a.pendingReview} to mark` : ''}{a.dueOn ? `, due ${fmtDate(a.dueOn)}` : ''}</span></div>)}
        {s.exercises.length === 0 ? <p className="muted">Add exercises to the lesson to assign them here.</p> : (
          <>
            {s.exercises.map((e) => <label key={e.id} className="check" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={!!pick[e.id]} onChange={() => setPick({ ...pick, [e.id]: !pick[e.id] })} /><ExerciseSummary e={e} /></label>)}
            <div className="row">
              <label className="field" style={{ width: 200 }}>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
              <button className="btn" style={{ alignSelf: 'end' }} disabled={!Object.values(pick).some(Boolean)} onClick={() => act(async () => { await api('/assignments', { body: { groupId: s.group.id, sessionId: s.id, exerciseIds: Object.keys(pick).filter((k) => pick[k]), dueOn: due || null } }); setPick({}); assigns.reload(); }, 'Tasks assigned')}>Assign to group</button>
            </div>
          </>
        )}
        <Link to={`/groups/${s.group.id}`} className="small">Mark answers in the group page</Link>
      </section>
      {node}
    </>
  );
}
