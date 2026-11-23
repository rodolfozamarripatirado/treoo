import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Lesson } from '../api';
import { Dialog, ErrorNote, Loading, RouteBar } from '../components/ui';
import { useLoad } from '../session';

interface SessionDetail { id: string; group: { name: string }; lesson: Lesson | null; sharedNotes: string | null; privateNotes: string | null }
const COLOURS = ['#FFE45C', '#FFFFFF', '#7FE0D6', '#FF8A80'];

const fmt = (s: number) => { const a = Math.abs(Math.round(s)); return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };

/**
 * Class mode for the projector. Shows only what the class should see: activity titles and instructions.
 * Teacher notes, answers and student data never appear here.
 */
export function Present() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error } = useLoad(() => api<SessionDetail>(`/sessions/${id}`), [id]);
  const [i, setI] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number[]>([]);
  const [extra, setExtra] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [colour, setColour] = useState(COLOURS[0]!);
  const [drawn, setDrawn] = useState(false);
  const [finish, setFinish] = useState(false);
  const [notes, setNotes] = useState({ sharedNotes: '', privateNotes: '', shareBoard: true });
  const [err, setErr] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  const acts = data?.lesson?.activities ?? [];
  const act = acts[i];
  const planned = act?.durationMinutes != null ? act.durationMinutes * 60 + (extra[i] ?? 0) : null;
  const spent = elapsed[i] ?? 0;
  const remaining = planned != null ? planned - spent : null;

  useEffect(() => { if (data) setNotes((n) => ({ ...n, sharedNotes: data.sharedNotes ?? '', privateNotes: data.privateNotes ?? '' })); }, [data]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => { const c = [...e]; c[i] = (c[i] ?? 0) + 1; return c; }), 1000);
    return () => clearInterval(t);
  }, [running, i]);

  // Keep the board canvas sized to the stage.
  useEffect(() => {
    const c = canvas.current, s = stage.current;
    if (!c || !s) return;
    const fit = () => {
      const img = drawn ? c.toDataURL() : null;
      c.width = s.clientWidth * devicePixelRatio; c.height = s.clientHeight * devicePixelRatio;
      if (img) { const im = new Image(); im.onload = () => c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height); im.src = img; }
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(s);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const go = useCallback((d: number) => setI((x) => Math.min(Math.max(0, x + d), Math.max(0, acts.length - 1))), [acts.length]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (finish || (e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === ' ') { e.preventDefault(); setRunning((r) => !r); }
      else if (e.key.toLowerCase() === 'b') setDrawing((d) => !d);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [go, finish]);

  const point = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * devicePixelRatio, y: (e.clientY - r.top) * devicePixelRatio }; };
  const down = (e: React.PointerEvent) => { if (!drawing) return; canvas.current!.setPointerCapture(e.pointerId); last.current = point(e); };
  const move = (e: React.PointerEvent) => {
    if (!drawing || !last.current) return;
    const ctx = canvas.current!.getContext('2d')!, p = point(e);
    ctx.strokeStyle = colour; ctx.lineWidth = 4 * devicePixelRatio; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; setDrawn(true);
  };
  const clear = () => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDrawn(false); };

  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); };

  const save = async () => {
    setErr(null);
    try {
      let board: string | null = null;
      if (drawn && canvas.current) {
        // Flatten onto the stage colour so the saved board is readable outside class mode.
        const c = canvas.current, out = document.createElement('canvas');
        out.width = c.width; out.height = c.height;
        const o = out.getContext('2d')!; o.fillStyle = '#11172b'; o.fillRect(0, 0, out.width, out.height); o.drawImage(c, 0, 0);
        board = out.toDataURL('image/png');
      }
      await api(`/sessions/${id}/deliver`, { body: { ...notes, board, shareBoard: drawn && notes.shareBoard } });
      if (document.fullscreenElement) await document.exitFullscreen();
      nav(`/classes/${id}`);
    } catch (e) { setErr((e as Error).message); }
  };

  if (error) return <main className="page"><ErrorNote msg={error} /></main>;
  if (!data) return <main className="page"><Loading /></main>;
  if (!data.lesson || acts.length === 0) return <main className="page"><p>This class has no lesson activities to present. <Link to={`/classes/${id}`}>Back to the class</Link></p></main>;

  const pct = planned ? Math.min(100, (spent / planned) * 100) : 0;
  return (
    <div className="class-mode">
      <div className="class-mode-top">
        <Link className="btn" to={`/classes/${id}`}>Exit</Link>
        <RouteBar activities={acts} current={i} showMeta={false} />
        <span className="small" style={{ opacity: .8 }}>{data.group.name}, {i + 1} of {acts.length}</span>
      </div>

      <div className="class-mode-stage" ref={stage}>
        <div>
          {act?.kind && <div className="class-mode-kind">{act.kind}</div>}
          <h2>{act?.title || 'Activity'}</h2>
          {act?.instructions && <p>{act.instructions}</p>}
        </div>
        <canvas ref={canvas} className="board" style={{ pointerEvents: drawing ? 'auto' : 'none', width: '100%', height: '100%' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={() => (last.current = null)} onPointerLeave={() => (last.current = null)} aria-label="Board" />
      </div>

      <div className="class-mode-bottom">
        <div className="row">
          <button className="btn" onClick={() => go(-1)} disabled={i === 0}>Previous</button>
          <button className="btn" onClick={() => go(1)} disabled={i === acts.length - 1}>Next</button>
        </div>
        <div className="row" aria-live="off">
          <span className={`timer ${remaining != null && remaining < 0 ? 'over' : ''}`} style={{ ['--progress' as string]: `${pct}%`, ['--show-progress' as string]: pct > 0 ? 'block' : 'none' }} aria-label="Timer">
            {remaining != null ? fmt(remaining) : fmt(spent)}
          </span>
          <button className={`btn ${running ? 'on' : ''}`} onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Start'}</button>
          {planned != null && <button className="btn" onClick={() => setExtra((x) => { const c = [...x]; c[i] = (c[i] ?? 0) + 60; return c; })}>+1 min</button>}
          <button className="btn" onClick={() => setElapsed((e) => { const c = [...e]; c[i] = 0; return c; })}>Reset</button>
        </div>
        <div className="row">
          <div className="board-tools">
            <button className={`btn ${drawing ? 'on' : ''}`} onClick={() => setDrawing(!drawing)} aria-pressed={drawing}>Draw</button>
            {drawing && COLOURS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={colour === c} onClick={() => setColour(c)} />)}
            {drawn && <button className="btn" onClick={clear}>Clear</button>}
          </div>
          <button className="btn" onClick={fullscreen}>Full screen</button>
          <button className="btn on" onClick={() => setFinish(true)}>Finish class</button>
        </div>
      </div>

      <Dialog open={finish} onClose={() => setFinish(false)} label="Finish class">
        <h2>Finish class</h2>
        <p className="muted">This records the class as taught. Nothing is published to students until you choose to.</p>
        <ErrorNote msg={err} />
        <div className="stack">
          <label className="field">Notes for students<textarea rows={3} value={notes.sharedNotes} onChange={(e) => setNotes({ ...notes, sharedNotes: e.target.value })} /></label>
          <label className="field">Private notes<textarea rows={2} value={notes.privateNotes} onChange={(e) => setNotes({ ...notes, privateNotes: e.target.value })} /></label>
          {drawn && <label className="check"><input type="checkbox" checked={notes.shareBoard} onChange={(e) => setNotes({ ...notes, shareBoard: e.target.checked })} />Keep the board so students can see it when published</label>}
          <div className="row"><button className="btn primary" onClick={save}>Save and close</button><button className="btn" onClick={() => setFinish(false)}>Back to class</button></div>
        </div>
      </Dialog>
    </div>
  );
}
