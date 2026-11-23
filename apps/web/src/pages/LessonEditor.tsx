import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, fmtDate, saveWithRetry, type Activity, type Exercise, type Lesson, type Material } from '../api';
import { AiPill, Dialog, ErrorNote, Loading, RouteBar, useToast } from '../components/ui';
import { ExerciseEditor, ExerciseSummary, type ExerciseDraft } from '../components/Exercises';
import { VocabEditor, type Word } from '../components/Vocab';

const KINDS = ['warm-up', 'presentation', 'controlled practice', 'freer practice', 'speaking', 'listening', 'reading', 'writing', 'review', 'homework'];

interface Form {
  title: string; topic: string; level: string; objective: string; methodology: string; notes: string;
  status: 'draft' | 'ready'; materialId: string | null; curriculumTopicId: string | null; activities: (Activity & { key: string; durationText: string })[];
}
type Draft = { title: string; topic?: string | null; level?: string | null; objective?: string | null; methodology?: string | null; activities: Activity[]; exercises: ExerciseDraft[] };

const key = () => crypto.randomUUID();
const toForm = (l: Partial<Lesson> & { activities: Activity[] }): Form => ({
  title: l.title ?? '', topic: l.topic ?? '', level: l.level ?? '', objective: l.objective ?? '', methodology: l.methodology ?? '', notes: l.notes ?? '',
  status: l.status ?? 'draft', materialId: l.materialId ?? null, curriculumTopicId: l.curriculumTopicId ?? null,
  activities: l.activities.map((a) => ({ ...a, key: key(), durationText: a.durationMinutes == null ? '' : String(a.durationMinutes) })),
});
const parseDuration = (t: string): number | null | 'invalid' => {
  const s = t.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 600 ? n : 'invalid';
};
const payload = (f: Form) => ({
  title: f.title, topic: f.topic, level: f.level, objective: f.objective, methodology: f.methodology, notes: f.notes,
  status: f.status, materialId: f.materialId, curriculumTopicId: f.curriculumTopicId,
  activities: f.activities.map((a) => ({ kind: a.kind || null, title: a.title || null, instructions: a.instructions || null, durationMinutes: parseDuration(a.durationText) as number | null })),
});

export function LessonEditor() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { toast, node } = useToast();
  const incoming = (loc.state ?? null) as { draft: Draft; origin: string; model: string; materialId: string } | null;

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Lesson | null>(null);
  const [askPreview, setAskPreview] = useState(false);
  const [proposed, setProposed] = useState<(ExerciseDraft & { keep: boolean })[]>([]);
  const [material, setMaterial] = useState<Material | null>(null);
  const [showEditor, setShowEditor] = useState(true);
  const [aiOn, setAiOn] = useState(false);
  const [units, setUnits] = useState<{ id: string; level: string; title: string; topics: { id: string; title: string }[] }[]>([]);
  useEffect(() => { api<typeof units>('/curriculum').then(setUnits).catch(() => setUnits([])); }, []);
  useEffect(() => { api<{ available: boolean }>('/ai/status').then((r) => setAiOn(r.available)).catch(() => setAiOn(false)); }, []);

  useEffect(() => {
    setError(null);
    if (isNew) {
      const d = incoming?.draft;
      const f = toForm({ ...(d ?? { title: '' }), materialId: incoming?.materialId ?? params.get('material'), activities: d?.activities ?? [] } as Lesson);
      setForm(f); setSaved(''); setLesson(null);
      setProposed((d?.exercises ?? []).map((e) => ({ ...e, keep: true })));
    } else {
      api<Lesson>(`/lessons/${id}`).then((l) => { setLesson(l); const f = toForm(l); setForm(f); setSaved(JSON.stringify(payload(f))); }).catch((e: Error) => setError(e.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const mid = form?.materialId;
    if (mid && mid !== material?.id) api<Material>(`/materials/${mid}`).then(setMaterial).catch(() => setMaterial(null));
  }, [form?.materialId, material?.id]);

  const dirty = form ? JSON.stringify(payload(form)) !== saved : false;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const routeActs = useMemo(() => form?.activities.map((a) => { const d = parseDuration(a.durationText); return { title: a.title, durationMinutes: typeof d === 'number' ? d : null }; }) ?? [], [form?.activities]);

  if (error && !form) return <ErrorNote msg={error} />;
  if (!form) return <Loading what="Opening lesson" />;
  const readOnly = !!lesson && lesson.canEdit === false;
  if (readOnly) return <LessonReadOnly lesson={lesson} />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const setAct = (i: number, patch: Partial<Form['activities'][number]>) => set('activities', form.activities.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const move = (i: number, d: -1 | 1) => { const a = [...form.activities]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x!); set('activities', a); };

  const validate = () => {
    if (!form.title.trim()) return 'Give the lesson a title before saving.';
    const bad = form.activities.findIndex((a) => parseDuration(a.durationText) === 'invalid');
    if (bad >= 0) return `Activity ${bad + 1}: the time must be a positive number of minutes (for example 7.5), or left empty.`;
    return null;
  };

  const save = async (overRevision?: number): Promise<Lesson | null> => {
    const v = validate();
    setFieldErr(v); setError(null);
    if (v) return null;
    setSaving(true);
    try {
      const body = payload(form);
      let l: Lesson;
      if (isNew) {
        const exercises = proposed.filter((e) => e.keep).map(({ keep: _k, ...e }) => ({ ...e, topic: e.topic ?? (form.topic || null) }));
        l = await saveWithRetry<Lesson>('/lessons', 'POST', { ...body, aiOrigin: incoming?.origin ?? null, exercises });
      } else {
        l = await saveWithRetry<Lesson>(`/lessons/${id}`, 'PUT', { ...body, expectedRevision: overRevision ?? lesson!.revision });
      }
      setLesson((prev) => ({ ...l, exercises: prev?.exercises ?? l.exercises, canEdit: true }));
      setSaved(JSON.stringify(body));
      toast('Lesson saved');
      if (isNew) nav(`/lessons/${l.id}`, { replace: true });
      return l;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict((e.details as { current: Lesson }).current);
      else setError((e as Error).message);
      return null;
    } finally { setSaving(false); }
  };

  const openPreview = () => {
    if (isNew || dirty) setAskPreview(true);
    else nav(`/lessons/${id}/preview`);
  };

  return (
    <>
      <Link className="back" to="/prepare">Back to lessons</Link>
      <div className="page-head">
        <div>
          <h1>{isNew ? (incoming ? 'Review the proposal' : 'New lesson') : form.title || 'Untitled lesson'}</h1>
          <div className="row muted small">
            {incoming && <AiPill origin={incoming.origin} />}
            {lesson && <><AiPill origin={lesson.aiOrigin} /><span>Revision {lesson.revision}, saved {fmtDate(lesson.updatedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></>}
          </div>
        </div>
        <div className="row">
          {material && <span className="pane-toggle"><button className="btn quiet" onClick={() => setShowEditor(!showEditor)}>{showEditor ? 'Show original' : 'Back to editor'}</button></span>}
          {!isNew && <Link className="btn quiet" to={`/lessons/${id}/print`}>Print handout</Link>}
          {!isNew && <button className="btn quiet" onClick={async () => { try { const r = await api<{ id: string }>(`/lessons/${id}/duplicate`, { method: 'POST' }); toast('Copy created'); nav(`/lessons/${r.id}`); } catch (e) { setError((e as Error).message); } }}>Duplicate</button>}
        </div>
      </div>
      {incoming && <div className="notice info"><p>This is an unsaved proposal{incoming.origin === 'mock' ? ' from simulated AI' : ` from ${incoming.model}`}. Change anything you like — nothing is stored until you save, and saving never publishes to students.</p></div>}
      <ErrorNote msg={error ?? fieldErr} />

      <div className={`editor ${material ? 'with-source' : ''} ${showEditor ? 'show-editor' : ''}`}>
        {material && (
          <aside className="sheet source-pane" aria-label="Source material">
            <h2>{material.title}</h2>
            {material.hasOriginal && <img src={`/api/materials/${material.id}/original`} alt={`Original of ${material.title}`} style={{ marginBottom: 12 }} />}
            {material.extractedText && <div className="source-text">{material.extractedText}</div>}
          </aside>
        )}
        <div className="stack edit-pane">
          <section className="sheet stack">
            <label className="field">Title<input value={form.title} aria-invalid={!!fieldErr && !form.title.trim()} onChange={(e) => set('title', e.target.value)} placeholder="Required to save" /></label>
            <div className="grid-2">
              <label className="field">Topic<input value={form.topic} onChange={(e) => set('topic', e.target.value)} placeholder="e.g. Present Perfect" /></label>
              <label className="field">Level<input value={form.level} onChange={(e) => set('level', e.target.value)} placeholder="e.g. B1+" /></label>
              <label className="field">Status<select value={form.status} onChange={(e) => set('status', e.target.value as Form['status'])}><option value="draft">Draft</option><option value="ready">Ready to teach</option></select></label>
            </div>
            {units.length > 0 && (
              <label className="field">Curriculum topic <span className="hint">Links this lesson to the academy curriculum so coverage is tracked when you teach it.</span>
                <select value={form.curriculumTopicId ?? ''} onChange={(e) => set('curriculumTopicId', e.target.value || null)}>
                  <option value="">Not linked</option>
                  {units.map((u) => <optgroup key={u.id} label={`${u.level}, ${u.title}`}>{u.topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>)}
                </select>
              </label>
            )}
            <label className="field">Objective<textarea rows={2} value={form.objective} onChange={(e) => set('objective', e.target.value)} /></label>
            <label className="field">Methodology<input value={form.methodology} onChange={(e) => set('methodology', e.target.value)} /></label>
          </section>

          <section>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Activities</h2>
            </div>
            {form.activities.length > 0 && <div style={{ marginBottom: 16 }}><RouteBar activities={routeActs} /></div>}
            <ol className="stops">
              {form.activities.map((a, i) => (
                <li className="stop" key={a.key}>
                  <div className="stop-card">
                    <div className="grid-act">
                      <label className="field"><span className="sr-only">Activity {i + 1} title</span><input value={a.title ?? ''} placeholder="Activity title" onChange={(e) => setAct(i, { title: e.target.value })} /></label>
                      <label className="field"><span className="sr-only">Type</span>
                        <select value={a.kind ?? ''} onChange={(e) => setAct(i, { kind: e.target.value || null })}><option value="">Type…</option>{KINDS.map((k) => <option key={k}>{k}</option>)}{a.kind && !KINDS.includes(a.kind) && <option>{a.kind}</option>}</select>
                      </label>
                      <label className="field"><span className="sr-only">Minutes</span>
                        <input inputMode="decimal" value={a.durationText} placeholder="Minutes" aria-invalid={parseDuration(a.durationText) === 'invalid'} onChange={(e) => setAct(i, { durationText: e.target.value })} />
                      </label>
                    </div>
                    <label className="field"><span className="sr-only">Instructions</span><textarea rows={2} value={a.instructions ?? ''} placeholder="Instructions for you or the class" onChange={(e) => setAct(i, { instructions: e.target.value })} /></label>
                    <div className="stop-tools">
                      <button className="btn quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move activity ${i + 1} up`}>Move up</button>
                      <button className="btn quiet" disabled={i === form.activities.length - 1} onClick={() => move(i, 1)} aria-label={`Move activity ${i + 1} down`}>Move down</button>
                      <button className="btn quiet" onClick={() => set('activities', [...form.activities.slice(0, i + 1), { ...a, key: key() }, ...form.activities.slice(i + 1)])}>Duplicate</button>
                      <button className="btn quiet" style={{ color: 'var(--alert)' }} onClick={() => set('activities', form.activities.filter((_, j) => j !== i))}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <button className="btn" onClick={() => set('activities', [...form.activities, { key: key(), kind: null, title: '', instructions: '', durationMinutes: null, durationText: '' }])}>Add activity</button>
          </section>

          <section className="sheet stack">
            <label className="field">Teacher notes <span className="hint">Private. Never shown to students or on the projector.</span><textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          </section>

          {isNew && proposed.length > 0 && (
            <section className="sheet stack">
              <h2 style={{ margin: 0 }}>Proposed exercises</h2>
              <p className="muted small">Ticked exercises are saved with the lesson. You can edit them afterwards.</p>
              {proposed.map((e, i) => (
                <label key={i} className="check" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={e.keep} onChange={() => setProposed(proposed.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)))} />
                  <ExerciseSummary e={e} />
                </label>
              ))}
            </section>
          )}
          {!isNew && lesson && <VocabEditor key={lesson.id} lessonId={lesson.id} initial={(lesson as Lesson & { vocab?: Word[] }).vocab ?? []} aiAvailable={aiOn} />}
          {!isNew && lesson && <LessonExercises lesson={lesson} topic={form.topic} />}
        </div>
      </div>

      <div className="savebar">
        <span className={`savestate ${dirty || isNew ? 'dirty' : ''}`} aria-live="polite">{saving ? 'Saving…' : isNew ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button className="btn" onClick={openPreview}>Preview</button>
        <button className="btn primary" onClick={() => void save()} disabled={saving || (!isNew && !dirty)}>Save lesson</button>
      </div>

      <Dialog open={askPreview} onClose={() => setAskPreview(false)} label="Save before preview">
        <h2>Preview shows the saved lesson</h2>
        <p>{isNew ? 'Save this lesson first to preview it.' : 'You have unsaved changes. Save them to see them in the preview, or keep editing.'}</p>
        <div className="row">
          <button className="btn primary" onClick={async () => { setAskPreview(false); const l = await save(); if (l) nav(`/lessons/${l.id}/preview`); }}>Save and preview</button>
          <button className="btn" onClick={() => setAskPreview(false)}>Keep editing</button>
        </div>
      </Dialog>

      <Dialog open={!!conflict} onClose={() => setConflict(null)} label="Lesson changed elsewhere">
        <h2>This lesson changed somewhere else</h2>
        <p>Another tab or device saved revision {conflict?.revision} (“{conflict?.title}”) after you opened it. Your edits have <strong>not</strong> been saved yet.</p>
        <div className="stack">
          <button className="btn" onClick={() => { if (!conflict) return; setLesson({ ...conflict, exercises: lesson?.exercises, canEdit: true }); const f = toForm(conflict); setForm(f); setSaved(JSON.stringify(payload(f))); setConflict(null); }}>Discard my edits and load the saved version</button>
          <button className="btn danger" onClick={async () => { const rev = conflict!.revision; setConflict(null); await save(rev); }}>Replace the saved version with mine</button>
          <button className="btn quiet" onClick={() => setConflict(null)}>Keep editing (decide later)</button>
        </div>
      </Dialog>
      {node}
    </>
  );
}

function LessonExercises({ lesson, topic }: { lesson: Lesson; topic: string }) {
  const [items, setItems] = useState<(Exercise & { attempts?: number })[]>(lesson.exercises ?? []);
  const [editing, setEditing] = useState<(Exercise & { attempts?: number; asNewVersion?: boolean }) | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const saveEx = async (e: ExerciseDraft) => {
    setErr(null);
    try {
      if (editing === 'new') { const x = await api<Exercise>('/exercises', { body: { ...e, lessonId: lesson.id, topic: e.topic || topic || null } }); setItems([...items, x]); }
      else if (editing?.asNewVersion) { const x = await api<Exercise>(`/exercises/${editing.id}/new-version`, { body: e }); setItems([...items, x]); }
      else if (editing) { const x = await api<Exercise>(`/exercises/${editing.id}`, { method: 'PUT', body: e }); setItems(items.map((i) => (i.id === x.id ? { ...x, attempts: i.attempts } : i))); }
      setEditing(null);
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <section className="sheet stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Exercises</h2><button className="btn" onClick={() => setEditing('new')}>Add exercise</button></div>
      <p className="muted small">Exercises are saved immediately and can be assigned to a group from a class.</p>
      <ErrorNote msg={err} />
      {items.length === 0 && !editing && <p className="muted">No exercises yet.</p>}
      {items.map((e) => editing !== 'new' && editing?.id === e.id ? <ExerciseEditor key={e.id} initial={e} onSave={saveEx} onCancel={() => setEditing(null)} /> : (
        <div key={e.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', borderTop: '1px solid var(--rule)', paddingTop: 10 }}>
          <ExerciseSummary e={e} />
          {e.attempts ? (
            <span className="row"><span className="pill" title="Students have answered it, so it is locked to keep their marks meaningful">Answered by {e.attempts}, locked</span>
              <button className="btn quiet" onClick={() => setEditing({ ...e, asNewVersion: true })}>Create new version</button></span>
          ) : (
            <span className="row"><button className="btn quiet" onClick={() => setEditing(e)}>Edit</button>
              <button className="btn quiet" style={{ color: 'var(--alert)' }} onClick={async () => { await api(`/exercises/${e.id}`, { method: 'DELETE' }); setItems(items.filter((i) => i.id !== e.id)); }}>Delete</button></span>
          )}
        </div>
      ))}
      {editing === 'new' && <ExerciseEditor onSave={saveEx} onCancel={() => setEditing(null)} />}
    </section>
  );
}

function LessonReadOnly({ lesson }: { lesson: Lesson }) {
  return (
    <>
      <Link className="back" to="/prepare">Back to lessons</Link>
      <div className="notice info"><p>You are reviewing {lesson.ownerName}’s lesson. Only the owner can edit it.</p></div>
      <div className="row" style={{ marginBottom: 12 }}><Link className="btn" to={`/lessons/${lesson.id}/print`}>Print handout</Link><button className="btn" onClick={async () => { const r = await api<{ id: string }>(`/lessons/${lesson.id}/duplicate`, { method: 'POST' }); window.location.assign(`/lessons/${r.id}`); }}>Make my own copy</button></div>
      <LessonBody lesson={lesson} showNotes />
    </>
  );
}

export function LessonBody({ lesson, showNotes = false }: { lesson: Lesson; showNotes?: boolean }) {
  return (
    <article className="stack">
      <header>
        <h1>{lesson.title}</h1>
        <p className="muted">{[lesson.topic, lesson.level, lesson.methodology].filter(Boolean).join(', ')}</p>
        {lesson.objective && <p><strong>Objective:</strong> {lesson.objective}</p>}
      </header>
      {lesson.activities.length > 0 && <RouteBar activities={lesson.activities} />}
      <ol className="stops">
        {lesson.activities.map((a, i) => (
          <li className="stop" key={a.id ?? i}>
            <div className="stop-card">
              <div className="row" style={{ justifyContent: 'space-between' }}><strong>{a.title || 'Untitled activity'}</strong><span className="muted small">{[a.kind, a.durationMinutes != null ? `${a.durationMinutes} min` : 'No time set'].filter(Boolean).join(', ')}</span></div>
              {a.instructions && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.instructions}</p>}
            </div>
          </li>
        ))}
      </ol>
      {lesson.activities.length === 0 && <p className="muted">No activities yet.</p>}
      {(lesson.exercises?.length ?? 0) > 0 && <section className="sheet stack"><h2 style={{ margin: 0 }}>Exercises</h2>{lesson.exercises!.map((e) => <ExerciseSummary key={e.id} e={e} />)}</section>}
      {showNotes && lesson.notes && <section className="sheet"><h3>Teacher notes</h3><p style={{ whiteSpace: 'pre-wrap' }}>{lesson.notes}</p></section>}
    </article>
  );
}
