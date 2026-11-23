import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, type Material } from '../api';
import { AiPill, ErrorNote, Loading, StatusPill } from '../components/ui';
import { useLoad, useSession } from '../session';

interface LessonRow { id: string; title: string; topic: string | null; level: string | null; status: string; updatedAt: string; ownerName: string; activityCount: number; aiOrigin: string | null }

export function Prepare() {
  const { me } = useSession();
  const isAdmin = me?.active?.role === 'admin';
  const [q, setQ] = useState('');
  const lessons = useLoad(() => api<LessonRow[]>(`/lessons${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const materials = useLoad(() => api<Material[]>('/materials'), []);

  return (
    <>
      <div className="page-head">
        <div><h1>{isAdmin ? 'Lessons' : 'Prepare'}</h1><p className="muted">{isAdmin ? 'Review how lessons are being prepared across the academy.' : 'Start from a worksheet photo, pasted text, or a blank lesson.'}</p></div>
        <div className="row">
          <Link className="btn" to="/lessons/new">New blank lesson</Link>
          <Link className="btn primary" to="/prepare/capture">Start from material</Link>
        </div>
      </div>

      <label className="field" style={{ maxWidth: 420, marginBottom: 14 }}>
        <span className="sr-only">Search lessons</span>
        <input type="search" placeholder="Search by title or topic" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ErrorNote msg={lessons.error} />
      {!lessons.data ? <Loading /> : lessons.data.length === 0 ? (
        <div className="empty"><p>{q ? `No lessons match “${q}”.` : 'No lessons yet. Upload a worksheet photo and Treoo will help you turn it into a lesson.'}</p>{!q && <Link className="btn primary" to="/prepare/capture">Start from material</Link>}</div>
      ) : (
        <ul className="list">
          {lessons.data.map((l) => (
            <li key={l.id}>
              <Link className="list-link" to={`/lessons/${l.id}`}>
                <strong>{l.title}</strong>
                <span className="row"><AiPill origin={l.aiOrigin} /><StatusPill status={l.status} /></span>
                <span className="muted small">{[l.topic, l.level, `${l.activityCount} activities`, isAdmin ? l.ownerName : null].filter(Boolean).join(', ')}</span>
                <span className="muted small">Edited {fmtDate(l.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 36 }}>Material library</h2>
      <p className="muted">Originals are kept exactly as uploaded. Extracted text is what you reviewed.</p>
      {!materials.data ? <Loading /> : materials.data.length === 0 ? <p className="muted">No material yet.</p> : (
        <ul className="list">
          {materials.data.map((m) => (
            <li key={m.id}>
              <Link className="list-link" to={`/prepare/capture?material=${m.id}`}>
                <strong>{m.title}</strong>
                <span className="pill">{m.hasOriginal ? 'Photo' : 'Text'}</span>
                <span className="muted small">{[m.source, isAdmin ? m.ownerName : null].filter(Boolean).join(', ') || '—'}</span>
                <span className="muted small">{fmtDate(m.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
