import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, today } from '../api';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad, useSession } from '../session';

export interface CalEvent { id: string; kind: 'holiday' | 'event' | 'exam'; title: string; description: string | null; startsOn: string; endsOn: string; siteName: string | null; capacity: number | null; signupOpen: boolean; signups: number; signedUp?: boolean }
interface Staff { events: CalEvent[]; classes: { id: string; scheduledOn: string; topic: string | null; groupName: string; status: string }[] }
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const KIND_LABEL = { holiday: 'Holiday', event: 'Event', exam: 'Assessment' } as const;

/** Builds an ordered agenda of days with entries, so a phone shows the same information as a desktop. */
export function agenda<T extends { date: string }>(items: T[]) {
  const m = new Map<string, T[]>();
  for (const it of items.sort((a, b) => a.date.localeCompare(b.date))) m.set(it.date, [...(m.get(it.date) ?? []), it]);
  return [...m.entries()];
}

export function CalendarPage() {
  const { me } = useSession();
  const isAdmin = me?.active?.role === 'admin';
  const [from, setFrom] = useState(addDays(today(), -7));
  const to = addDays(from, 41);
  const data = useLoad(() => api<Staff>(`/calendar?from=${from}&to=${to}`), [from]);
  const [form, setForm] = useState({ kind: 'event', title: '', startsOn: today(), endsOn: today(), capacity: '', signupOpen: true, description: '' });
  const [err, setErr] = useState<string | null>(null);
  const [signups, setSignups] = useState<{ id: string; rows: { displayName: string; email: string }[] } | null>(null);
  const { toast, node } = useToast();
  const items = data.data ? [
    ...data.data.events.map((e) => ({ date: e.startsOn, kind: e.kind, e })),
    ...data.data.classes.map((c) => ({ date: c.scheduledOn.slice(0, 10), kind: 'class' as const, c })),
  ] : [];
  return (
    <>
      <div className="page-head">
        <div><h1>Calendar</h1><p className="muted">Classes, holidays, assessments and academy events.</p></div>
        <div className="row"><button className="btn" onClick={() => setFrom(addDays(from, -42))}>Earlier</button><button className="btn" onClick={() => setFrom(addDays(today(), -7))}>Today</button><button className="btn" onClick={() => setFrom(addDays(from, 42))}>Later</button></div>
      </div>
      {isAdmin && (
        <section className="sheet stack" style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>Add to the calendar</h2>
          <ErrorNote msg={err} />
          <div className="grid-2">
            <label className="field">Type<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="event">Event</option><option value="holiday">Holiday</option><option value="exam">Assessment</option></select></label>
            <label className="field">Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field">Starts<input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value, endsOn: e.target.value > form.endsOn ? e.target.value : form.endsOn })} /></label>
            <label className="field">Ends<input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></label>
            {form.kind === 'event' && <label className="field">Places <span className="hint">Leave empty for no limit</span><input inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></label>}
            {form.kind === 'event' && <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={form.signupOpen} onChange={(e) => setForm({ ...form, signupOpen: e.target.checked })} />Students can sign up</label>}
          </div>
          <label className="field">Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <button className="btn primary" style={{ justifySelf: 'start' }} disabled={!form.title.trim()} onClick={async () => {
            setErr(null);
            try { await api('/events', { body: { ...form, capacity: form.capacity ? Number(form.capacity) : null, signupOpen: form.kind === 'event' && form.signupOpen } }); setForm({ ...form, title: '', description: '' }); data.reload(); toast('Added to the calendar'); }
            catch (e) { setErr((e as Error).message); }
          }}>Add</button>
        </section>
      )}
      {!data.data ? <Loading /> : items.length === 0 ? <p className="muted">Nothing between {fmtDate(from)} and {fmtDate(to)}.</p> : agenda(items).map(([date, list]) => (
        <section key={date}>
          <h2 className="day-head">{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <ul className="list">{list.map((it, i) => (
            <li key={i}>{'c' in it && it.c ? (
              <Link className="list-link" to={`/classes/${it.c.id}`}><strong>{it.c.groupName}</strong><span className="pill">Class</span><span className="muted small">{it.c.topic ?? 'No topic'}</span></Link>
            ) : 'e' in it && it.e ? (
              <div className="list-link">
                <strong>{it.e.title}</strong><span className={`pill ${it.e.kind === 'holiday' ? 'absent' : it.e.kind === 'exam' ? 'draft' : 'ready'}`}>{KIND_LABEL[it.e.kind]}</span>
                <span className="muted small">{[it.e.endsOn !== it.e.startsOn ? `until ${fmtDate(it.e.endsOn)}` : null, it.e.siteName, it.e.signupOpen ? `${it.e.signups}${it.e.capacity ? `/${it.e.capacity}` : ''} signed up` : null].filter(Boolean).join(', ')}</span>
                {isAdmin && <span className="row" style={{ gridColumn: '1 / -1' }}>{it.e.signupOpen && <button className="btn quiet" onClick={async () => setSignups({ id: it.e!.id, rows: await api(`/events/${it.e!.id}/signups`) })}>Signups</button>}<button className="btn quiet" style={{ color: 'var(--alert)' }} onClick={async () => { await api(`/events/${it.e!.id}`, { method: 'DELETE' }); data.reload(); }}>Delete</button></span>}
              </div>
            ) : null}</li>
          ))}</ul>
          {signups && list.some((it) => 'e' in it && it.e?.id === signups.id) && <div className="sheet" style={{ marginTop: 8 }}>{signups.rows.length ? signups.rows.map((r) => <div key={r.email}>{r.displayName} <span className="muted small">{r.email}</span></div>) : <span className="muted">No signups yet.</span>}</div>}
        </section>
      ))}
      {node}
    </>
  );
}
