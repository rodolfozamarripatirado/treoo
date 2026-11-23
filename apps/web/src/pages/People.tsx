import { useState } from 'react';
import { api, type Person, type Role } from '../api';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad } from '../session';

export function People() {
  const [role, setRole] = useState<Role | ''>('');
  const people = useLoad(() => api<Person[]>(`/people${role ? `?role=${role}` : ''}`), [role]);
  const [form, setForm] = useState({ displayName: '', email: '', role: 'student' as Role, password: '' });
  const [err, setErr] = useState<string | null>(null);
  const { toast, node } = useToast();
  const add = async () => {
    setErr(null);
    try {
      await api('/people', { body: { ...form, password: form.password || undefined } });
      toast(`${form.displayName} added`); setForm({ displayName: '', email: '', role: form.role, password: '' }); people.reload();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <div className="page-head"><div><h1>People</h1><p className="muted">Everyone with access to this academy.</p></div></div>
      <section className="sheet stack" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Add a person</h2>
        <ErrorNote msg={err} />
        <div className="grid-2">
          <label className="field">Name<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
          <label className="field">Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field">Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></label>
          <label className="field">Initial password <span className="hint">Only for new accounts. At least 10 characters.</span><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        </div>
        <button className="btn primary" style={{ justifySelf: 'start' }} disabled={!form.displayName || !form.email} onClick={add}>Add person</button>
      </section>
      <div className="tabs" role="tablist">
        {(['', 'student', 'teacher', 'admin'] as const).map((r) => <button key={r} role="tab" aria-selected={role === r} onClick={() => setRole(r)}>{r ? `${r[0]!.toUpperCase()}${r.slice(1)}s` : 'Everyone'}</button>)}
      </div>
      {!people.data ? <Loading /> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
          {people.data.map((p) => <tr key={p.id}><td>{p.displayName}</td><td>{p.email}</td><td>{p.role}</td></tr>)}
        </tbody></table></div>
      )}
      {node}
    </>
  );
}
