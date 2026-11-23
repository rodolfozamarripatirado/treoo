import { useState } from 'react';
import { api } from '../api';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad } from '../session';

interface Site { id: string; name: string; address: string | null; groups: number }
interface Report { month: string; rule: string; active: number; enrolled: number; students: { id: string; displayName: string; email: string; classesAttended: number; groups: string }[] }

export function Academy() {
  const sites = useLoad(() => api<Site[]>('/academy/sites'), []);
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
