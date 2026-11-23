import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { ErrorNote, Loading, StatusPill } from '../components/ui';
import { useLoad, useSession } from '../session';

interface Dash {
  today: string;
  classes: { id: string; scheduledOn: string; startTime: string | null; endTime: string | null; cancelledReason: string | null; status: string; publishedAt: string | null; topic: string | null; groupId: string; groupName: string; schedule: string | null; lessonId: string | null; lessonTitle: string | null; students: number; attendanceTaken: number }[];
  toPublish: { id: string; scheduledOn: string; groupName: string; topic: string | null }[];
  toMark: { assignmentId: string; groupId: string; groupName: string; prompt: string; pending: number }[];
  attention: { id: string; displayName: string; groupName: string; reasons: string[] }[];
  drafts: { id: string; title: string; topic: string | null; updatedAt: string }[];
}

const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

/** The teacher's start page: what needs doing today, in the order a teacher meets it. */
export function Today() {
  const { me } = useSession();
  const { data, error } = useLoad(() => api<Dash>('/dashboard'), []);
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  const todays = data.classes.filter((c) => c.scheduledOn.slice(0, 10) === data.today);
  const later = data.classes.filter((c) => c.scheduledOn.slice(0, 10) !== data.today);
  const pendingMarks = data.toMark.reduce((s, m) => s + m.pending, 0);
  const first = me?.user.displayName.split(' ')[0];

  return (
    <>
      <div className="page-head">
        <div><h1>{greet()}, {first}</h1><p className="muted">{fmtDate(data.today, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
        <div className="row"><Link className="btn" to="/prepare/capture">Start from material</Link><Link className="btn primary" to="/classes">Schedule a class</Link></div>
      </div>

      <section className="today-classes">
        {todays.length === 0 ? (
          <div className="empty"><p>No classes today.</p>{later[0] && <p className="small">Next: {fmtDate(later[0].scheduledOn)}, {later[0].groupName}</p>}</div>
        ) : todays.map((c) => (
          <article key={c.id} className="class-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><h2 style={{ margin: 0 }}>{c.startTime ? `${c.startTime}–${c.endTime} ` : ''}{c.groupName}</h2><p className="muted small" style={{ margin: 0 }}>{c.status === 'cancelled' ? `Cancelled: ${c.cancelledReason ?? ''}` : [c.startTime ? null : c.schedule, `${c.students} students`].filter(Boolean).join(', ')}</p></div>
              <StatusPill status={c.status} />
            </div>
            <p style={{ margin: '12px 0' }}>{c.lessonTitle ? <Link to={`/lessons/${c.lessonId}`}>{c.lessonTitle}</Link> : <span className="muted">No lesson linked yet</span>}</p>
            <div className="row">
              {c.lessonId && c.status !== 'cancelled' && <Link className="btn primary" to={`/classes/${c.id}/present`}>Teach in class mode</Link>}
              <Link className="btn" to={`/classes/${c.id}`}>{c.attendanceTaken ? 'Open class' : 'Take attendance'}</Link>
            </div>
          </article>
        ))}
      </section>

      <div className="today-grid">
        <section className="sheet stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>To mark</h2>{pendingMarks > 0 && <span className="pill draft">{pendingMarks} {pendingMarks === 1 ? "answer" : "answers"}</span>}</div>
          {data.toMark.length === 0 ? <p className="muted">Nothing waiting. Closed questions mark themselves.</p> : data.toMark.map((m) => (
            <Link key={m.assignmentId} className="today-row" to={`/groups/${m.groupId}?open=${m.assignmentId}`}>
              <span>{m.prompt}<span className="muted small"> {m.groupName}</span></span><strong>{m.pending}</strong>
            </Link>
          ))}
        </section>

        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Worth a closer look</h2>
          {data.attention.length === 0 ? <p className="muted">No student stands out this month.</p> : data.attention.map((a) => (
            <Link key={`${a.id}-${a.groupName}`} className="today-row" to={`/students/${a.id}`}>
              <span><strong>{a.displayName}</strong><span className="muted small"> {a.groupName}</span><br /><span className="small">{a.reasons.join('; ')}</span></span>
            </Link>
          ))}
          <p className="muted small" style={{ margin: 0 }}>Based on attendance and task results in Treoo. A prompt to check in, not a judgement.</p>
        </section>

        {data.toPublish.length > 0 && (
          <section className="sheet stack">
            <h2 style={{ margin: 0 }}>Taught but not published</h2>
            {data.toPublish.map((s) => <Link key={s.id} className="today-row" to={`/classes/${s.id}`}><span>{fmtDate(s.scheduledOn)}, {s.groupName}<span className="muted small"> {s.topic}</span></span></Link>)}
            <p className="muted small" style={{ margin: 0 }}>Students only see a class after you publish it.</p>
          </section>
        )}

        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>This week</h2>
          {later.length === 0 ? <p className="muted">Nothing else scheduled in the next 7 days.</p> : later.map((c) => (
            <Link key={c.id} className="today-row" to={`/classes/${c.id}`}><span>{fmtDate(c.scheduledOn)}{c.startTime ? ` ${c.startTime}` : ''}, {c.groupName}{c.status === 'cancelled' ? ' (cancelled)' : ''}<span className="muted small"> {c.lessonTitle ?? 'no lesson yet'}</span></span></Link>
          ))}
        </section>

        {data.drafts.length > 0 && (
          <section className="sheet stack">
            <h2 style={{ margin: 0 }}>Drafts in progress</h2>
            {data.drafts.map((d) => <Link key={d.id} className="today-row" to={`/lessons/${d.id}`}><span>{d.title}<span className="muted small"> {d.topic}</span></span><span className="muted small">{fmtDate(d.updatedAt)}</span></Link>)}
          </section>
        )}
      </div>
    </>
  );
}
