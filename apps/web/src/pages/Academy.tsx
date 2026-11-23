import { useState } from 'react';
import { api } from '../api';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad } from '../session';

interface Site { id: string; name: string; address: string | null; groups: number }
interface Report { month: string; rule: string; active: number; enrolled: number; students: { id: string; displayName: string; email: string; classesAttended: number; groups: string }[] }

export function Academy() {
  const sites = useLoad(() => api<Site[]>('/academy/sites'), []);
  const settings = useLoad(() => api<{ timezone: string; today: string }>('/academy/settings'), []);
  const rooms = useLoad(() => api<{ id: string; name: string; capacity: number | null; siteId: string; siteName: string }[]>('/academy/rooms'), []);
  const [tz, setTz] = useState('');
  const [rf, setRf] = useState({ siteId: '', name: '', capacity: '' });
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Europe/Dublin'];
  const [form, setForm] = useState({ name: '', address: '' });
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const report = useLoad(() => api<Report>(`/academy/billing/active-students?month=${month}`), [month]);
  const [err, setErr] = useState<string | null>(null);
  const { toast, node } = useToast();
  return (
    <>
      <div className="page-head"><div><h1>Academy</h1><p className="muted">Sites and the monthly count of active students.</p></div></div>
      <div className="today-grid">
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Time zone</h2>
          <p className="muted small" style={{ margin: 0 }}>Class times, deadlines and “today” use this zone. Today here is {settings.data?.today ?? '…'}.</p>
          <div className="row" style={{ alignItems: 'end' }}>
            <label className="field" style={{ flex: 1 }}><span className="sr-only">Time zone</span><select value={tz || settings.data?.timezone || ''} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select></label>
            <button className="btn" disabled={!tz || tz === settings.data?.timezone} onClick={async () => { setErr(null); try { await api('/academy/settings', { method: 'PUT', body: { timezone: tz } }); settings.reload(); toast('Time zone saved'); } catch (e) { setErr((e as Error).message); } }}>Save</button>
          </div>
          <h2 style={{ margin: '12px 0 0' }}>Rooms</h2>
          {(rooms.data ?? []).map((r) => <div key={r.id} className="today-row"><span>{r.name}<span className="muted small"> {r.siteName}</span></span><span className="muted small">{r.capacity ? `${r.capacity} seats` : ''}</span></div>)}
          <div className="grid-2">
            <label className="field">Site<select value={rf.siteId} onChange={(e) => setRf({ ...rf, siteId: e.target.value })}><option value="">Choose a site</option>{(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="field">Room name<input value={rf.name} onChange={(e) => setRf({ ...rf, name: e.target.value })} /></label>
            <label className="field">Seats<input inputMode="numeric" value={rf.capacity} onChange={(e) => setRf({ ...rf, capacity: e.target.value })} /></label>
          </div>
          <button className="btn" style={{ justifySelf: 'start' }} disabled={!rf.siteId || !rf.name.trim()} onClick={async () => { setErr(null); try { await api('/academy/rooms', { body: { siteId: rf.siteId, name: rf.name, capacity: rf.capacity ? Number(rf.capacity) : null } }); setRf({ siteId: rf.siteId, name: '', capacity: '' }); rooms.reload(); toast('Room added'); } catch (e) { setErr((e as Error).message); } }}>Add room</button>
        </section>
        <section className="sheet stack">
          <h2 style={{ margin: 0 }}>Sites</h2>
          <ErrorNote msg={err} />
          {!sites.data ? <Loading /> : sites.data.map((s) => <div key={s.id} className="today-row"><span><strong>{s.name}</strong><span className="muted small"> {s.address}</span></span><span className="muted small">{s.groups} groups</span></div>)}
          <div className="grid-2">
            <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          </div>
          <button className="btn" style={{ justifySelf: 'start' }} disabled={!form.name.trim()} onClick={async () => { setErr(null); try { await api('/academy/sites', { body: form }); setForm({ name: '', address: '' }); sites.reload(); toast('Site added'); } catch (e) { setErr((e as Error).message); } }}>Add site</button>
          <p className="muted small" style={{ margin: 0 }}>Assign each group to a site from the group page.</p>
        </section>
        <section className="sheet stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Active students</h2>
            <label className="field" style={{ width: 170 }}><span className="sr-only">Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          </div>
          {!report.data ? <Loading /> : (<>
            <p style={{ fontFamily: 'var(--display)', fontSize: '2.4rem', margin: 0 }}>{report.data.active} <span className="muted" style={{ fontSize: '1rem' }}>of {report.data.enrolled} enrolled</span></p>
            <div className="notice warn"><p><strong>Proposed rule:</strong> {report.data.rule} The billable definition is not decided yet.</p></div>
            {report.data.students.map((s) => <div key={s.id} className="today-row"><span>{s.displayName}<span className="muted small"> {s.groups}</span></span><span className="muted small">{s.classesAttended} classes</span></div>)}
            <a className="btn" style={{ justifySelf: 'start' }} href={`/api/academy/billing/active-students?month=${month}&format=csv`}>Download CSV</a>
          </>)}
        </section>
      </div>
      {node}
    </>
  );
}
