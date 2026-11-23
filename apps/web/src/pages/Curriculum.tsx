import { useMemo, useState } from 'react';
import { api } from '../api';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad, useSession } from '../session';

export interface Topic { id?: string; title: string; objective: string | null; skill: string | null }
export interface Unit { id: string; level: string; position: number; title: string; description: string | null; topics: Topic[] }
const SKILLS = ['grammar', 'vocabulary', 'reading', 'listening', 'speaking', 'writing', 'interaction', 'mediation'];

export function Curriculum() {
  const { me } = useSession();
  const isAdmin = me?.active?.role === 'admin';
  const all = useLoad(() => api<Unit[]>('/curriculum'), []);
  const levels = useMemo(() => [...new Set((all.data ?? []).map((u) => u.level))], [all.data]);
  const [level, setLevel] = useState<string>('');
  const [editing, setEditing] = useState<Unit | 'new' | null>(null);
  const shown = level || levels[0] || '';
  const units = (all.data ?? []).filter((u) => u.level === shown);
  return (
    <>
      <div className="page-head">
        <div><h1>Curriculum</h1><p className="muted">{isAdmin ? 'Levels, units and topics your academy teaches. Teachers link lessons to topics to track coverage.' : 'The academy curriculum. Link your lessons to topics to show coverage.'}</p></div>
        {isAdmin && <button className="btn primary" onClick={() => setEditing('new')}>New unit</button>}
      </div>
      <div className="tabs" role="tablist">
        {levels.map((l) => <button key={l} role="tab" aria-selected={shown === l} onClick={() => setLevel(l)}>{l}</button>)}
      </div>
      {!all.data ? <Loading /> : levels.length === 0 && editing !== 'new' ? <div className="empty"><p>No curriculum yet.{isAdmin ? ' Create the first unit.' : ''}</p></div> : null}
      {editing === 'new' && <UnitEditor initial={{ id: '', level: shown || 'B1', position: 0, title: '', description: null, topics: [{ title: '', objective: null, skill: null }] }} onDone={() => { setEditing(null); all.reload(); }} />}
      <div className="stack">
        {units.map((u) => editing !== 'new' && editing?.id === u.id ? <UnitEditor key={u.id} initial={u} onDone={() => { setEditing(null); all.reload(); }} /> : (
          <section key={u.id} className="sheet stack">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{u.title}</h2>{isAdmin && <button className="btn quiet" onClick={() => setEditing(u)}>Edit</button>}</div>
            {u.description && <p className="muted" style={{ margin: 0 }}>{u.description}</p>}
            <ol className="stops">{u.topics.map((t) => <li key={t.id} className="stop"><div className="stop-card"><div className="row" style={{ justifyContent: 'space-between' }}><strong>{t.title}</strong>{t.skill && <span className="pill">{t.skill}</span>}</div>{t.objective && <span className="small">{t.objective}</span>}</div></li>)}</ol>
          </section>
        ))}
      </div>
    </>
  );
}

function UnitEditor({ initial, onDone }: { initial: Unit; onDone: () => void }) {
  const [u, setU] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const { toast, node } = useToast();
  const setT = (i: number, p: Partial<Topic>) => setU({ ...u, topics: u.topics.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const save = async () => {
    setErr(null);
    try {
      const body = { level: u.level, title: u.title, description: u.description, topics: u.topics.filter((t) => t.title.trim()) };
      if (initial.id) await api(`/curriculum/units/${initial.id}`, { method: 'PUT', body }); else await api('/curriculum/units', { body });
      toast('Unit saved'); onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <section className="sheet stack">
      <ErrorNote msg={err} />
      <div className="grid-2">
        <label className="field">Level<input value={u.level} onChange={(e) => setU({ ...u, level: e.target.value })} placeholder="e.g. B1+" /></label>
        <label className="field">Unit title<input value={u.title} onChange={(e) => setU({ ...u, title: e.target.value })} /></label>
      </div>
      <label className="field">Description<input value={u.description ?? ''} onChange={(e) => setU({ ...u, description: e.target.value })} /></label>
      <h3 style={{ margin: 0 }}>Topics</h3>
      {u.topics.map((t, i) => (
        <div key={t.id ?? i} className="vocab-row">
          <input aria-label="Topic" placeholder="Topic" value={t.title} onChange={(e) => setT(i, { title: e.target.value })} />
          <select aria-label="Skill" value={t.skill ?? ''} onChange={(e) => setT(i, { skill: e.target.value || null })}><option value="">Skill…</option>{SKILLS.map((s) => <option key={s}>{s}</option>)}</select>
          <input aria-label="Objective" placeholder="Can-do objective" value={t.objective ?? ''} onChange={(e) => setT(i, { objective: e.target.value })} />
          <span />
          <button className="btn quiet" style={{ color: 'var(--alert)' }} onClick={() => setU({ ...u, topics: u.topics.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      <div className="row">
        <button className="btn" onClick={() => setU({ ...u, topics: [...u.topics, { title: '', objective: null, skill: null }] })}>Add topic</button>
        <button className="btn primary" disabled={!u.title.trim() || !u.level.trim()} onClick={save}>Save unit</button>
        <button className="btn quiet" onClick={onDone}>Cancel</button>
        {initial.id && <button className="btn quiet" style={{ color: 'var(--alert)', marginLeft: 'auto' }} onClick={async () => { if (confirm(`Delete “${initial.title}” and its topics?`)) { await api(`/curriculum/units/${initial.id}`, { method: 'DELETE' }); onDone(); } }}>Delete unit</button>}
      </div>
      {node}
    </section>
  );
}
