import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Material } from '../api';
import { ErrorNote, Loading, useToast } from '../components/ui';
import { useLoad } from '../session';

type AiStatus = { mode: 'manual' | 'mock' | 'ollama'; available: boolean; detail: string };

const STATUS_TEXT: Record<Material['extractionStatus'], string> = {
  none: 'Not extracted yet',
  manual: 'Reviewed by you',
  ai: 'Extracted by AI — please review',
  mock: 'Simulated extraction — replace with the real text',
  failed: 'Extraction failed — type or paste the text',
};

/** Material → reviewed text → AI proposal or manual lesson. Nothing reaches students from here. */
export function Capture() {
  const [params, setParams] = useSearchParams();
  const materialId = params.get('material');
  const nav = useNavigate();
  const { toast, node } = useToast();
  const ai = useLoad(() => api<AiStatus>('/ai/status'), []);
  const [mode, setMode] = useState<'photo' | 'text'>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const material = useLoad(() => (materialId ? api<Material>(`/materials/${materialId}`) : Promise.resolve(null)), [materialId]);
  const [review, setReview] = useState('');
  const [plan, setPlan] = useState({ level: '', topic: '', totalMinutes: '60', preferences: '' });

  useEffect(() => { if (material.data) setReview(material.data.extractedText ?? ''); }, [material.data]);
  const previewUrl = file ? URL.createObjectURL(file) : null;
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const upload = () => run('Uploading', async () => {
    let m: Material;
    if (mode === 'photo') {
      if (!file) throw new Error('Choose or take a photo first.');
      const form = new FormData();
      form.append('title', title); form.append('source', source); form.append('file', file);
      m = await api<Material>('/materials', { form, method: 'POST' });
    } else {
      m = await api<Material>('/materials', { body: { title: title || 'Pasted text', source, text } });
    }
    setParams({ material: m.id });
  });

  const extract = () => run('Reading the photo', async () => {
    const m = await api<Material>(`/materials/${materialId}/extract`, { method: 'POST' });
    material.setData(m); setReview(m.extractedText ?? '');
  });

  const saveReview = async () => {
    const m = material.data!;
    const u = await api<Material>(`/materials/${m.id}`, { method: 'PUT', body: { title: m.title, source: m.source, extractedText: review } });
    material.setData(u);
    return u;
  };

  const generate = () => run('Writing a proposal', async () => {
    if (!review.trim()) throw new Error('Add or review the text first — the proposal is based only on it.');
    if (review !== (material.data?.extractedText ?? '')) await saveReview();
    const r = await api<{ draft: unknown; origin: string; model: string }>('/ai/draft', {
      body: { materialId, level: plan.level || null, topic: plan.topic || null, totalMinutes: Number(plan.totalMinutes) || null, preferences: plan.preferences || null },
    });
    nav('/lessons/new', { state: { draft: r.draft, origin: r.origin, model: r.model, materialId } });
  });

  const manual = () => run('Saving', async () => {
    if (review !== (material.data?.extractedText ?? '')) await saveReview();
    nav(`/lessons/new?material=${materialId}`);
  });

  if (materialId && !material.data) return material.error ? <ErrorNote msg={material.error} /> : <Loading />;
  const m = material.data;
  const aiReady = ai.data?.available;

  return (
    <>
      <Link className="back" to="/prepare">Back to Prepare</Link>
      <div className="page-head"><div><h1>{m ? m.title : 'Start from material'}</h1><p className="muted">{m ? 'Check the text, then let Treoo propose a lesson — or build it yourself.' : 'A photo of a worksheet or page, or text you paste.'}</p></div></div>
      {ai.data && !aiReady && <div className="notice warn"><p>{ai.data.detail} You can still review the text and build the lesson manually.</p></div>}
      {ai.data?.mode === 'mock' && <div className="notice info"><p>This demo uses <strong>simulated AI</strong>: extraction and proposals are placeholders, not real model output.</p></div>}
      <ErrorNote msg={error} />

      {!m ? (
        <div className="sheet stack" style={{ maxWidth: 720 }}>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'photo'} onClick={() => setMode('photo')}>Photo</button>
            <button role="tab" aria-selected={mode === 'text'} onClick={() => setMode('text')}>Paste text</button>
          </div>
          <div className="grid-2">
            <label className="field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unit 4 — Present Perfect" /></label>
            <label className="field">Source <span className="hint">Book, page or author, if known</span><input value={source} onChange={(e) => setSource(e.target.value)} /></label>
          </div>
          {mode === 'photo' ? (
            <label className="field">Photo of the page <span className="hint">PNG, JPEG or WebP, up to 10 MB. On a phone you can take it now.</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <label className="field">Text<textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} /></label>
          )}
          {previewUrl && <img src={previewUrl} alt="Selected page" style={{ maxHeight: 280, objectFit: 'contain', alignSelf: 'start' }} />}
          <div className="row"><button className="btn primary" onClick={upload} disabled={!!busy}>{busy ?? 'Continue'}</button></div>
        </div>
      ) : (
        <div className="editor with-source show-editor">
          <section className="sheet source-pane" aria-label="Original">
            <h2>Original</h2>
            {m.hasOriginal ? <img src={`/api/materials/${m.id}/original`} alt={`Original of ${m.title}`} /> : <div className="source-text">{m.sourceText}</div>}
            {m.source && <p className="muted small" style={{ marginTop: 8 }}>Source: {m.source}</p>}
          </section>
          <section className="stack edit-pane">
            <div className="sheet stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>Text to work from</h2>
                <span className={`pill ${m.extractionStatus === 'mock' ? 'sim' : ''}`}>{STATUS_TEXT[m.extractionStatus]}</span>
              </div>
              {m.hasOriginal && (
                <div className="row">
                  <button className="btn" onClick={extract} disabled={!!busy || !aiReady}>{busy === 'Reading the photo' ? 'Reading the photo…' : m.extractedText ? 'Extract again with AI' : 'Extract text with AI'}</button>
                  <span className="muted small">{aiReady ? 'Unreadable parts are marked [Unclear].' : 'Or type the text yourself below.'}</span>
                </div>
              )}
              <label className="field"><span className="sr-only">Extracted text</span>
                <textarea rows={14} value={review} onChange={(e) => setReview(e.target.value)} placeholder="The text of the material appears here. Correct anything that is wrong before continuing." />
              </label>
              <div className="row"><button className="btn quiet" disabled={!!busy || review === (m.extractedText ?? '')} onClick={() => run('Saving', async () => { await saveReview(); toast('Text saved'); })}>Save text</button></div>
            </div>

            <div className="sheet stack">
              <h2 style={{ margin: 0 }}>Turn it into a lesson</h2>
              <div className="grid-2">
                <label className="field">Level<input value={plan.level} onChange={(e) => setPlan({ ...plan, level: e.target.value })} placeholder="e.g. B1+" /></label>
                <label className="field">Topic<input value={plan.topic} onChange={(e) => setPlan({ ...plan, topic: e.target.value })} placeholder="From the material" /></label>
                <label className="field">Class length (minutes)<input type="number" min={5} max={600} value={plan.totalMinutes} onChange={(e) => setPlan({ ...plan, totalMinutes: e.target.value })} /></label>
              </div>
              <label className="field">Preferences <span className="hint">Methodology, group profile, what to avoid</span><input value={plan.preferences} onChange={(e) => setPlan({ ...plan, preferences: e.target.value })} placeholder="e.g. lots of speaking, teenagers" /></label>
              <div className="row">
                <button className="btn primary" onClick={generate} disabled={!!busy || !aiReady}>{busy === 'Writing a proposal' ? 'Writing a proposal…' : 'Propose a lesson with AI'}</button>
                <button className="btn" onClick={manual} disabled={!!busy}>Build it myself</button>
              </div>
              <p className="muted small">The proposal opens in the editor unsaved. You decide what to keep.</p>
            </div>
          </section>
        </div>
      )}
      {node}
    </>
  );
}
