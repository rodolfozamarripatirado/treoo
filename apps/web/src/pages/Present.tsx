import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Lesson } from '../api';
import { Dialog, ErrorNote, Loading, RouteBar } from '../components/ui';
import { useLoad } from '../session';

interface SessionDetail { id: string; group: { name: string }; lesson: Lesson | null; sharedNotes: string | null; privateNotes: string | null; roster: { id: string; displayName: string; status: Att | null }[] }
type Att = 'present' | 'absent' | 'late' | 'excused';
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; } return b; };
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
  const [tool, setTool] = useState<null | 'pick' | 'teams' | 'roll'>(null);
  const [roll, setRoll] = useState<Record<string, Att>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [usedPicks, setUsedPicks] = useState<string[]>([]);
  const [teamSize, setTeamSize] = useState(2);
  const [teams, setTeams] = useState<string[][]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  const acts = data?.lesson?.activities ?? [];
  const act = acts[i];
  const planned = act?.durationMinutes != null ? act.durationMinutes * 60 + (extra[i] ?? 0) : null;
  const spent = elapsed[i] ?? 0;
  const remaining = planned != null ? planned - spent : null;

  useEffect(() => {
    if (!data) return;
    setNotes((n) => ({ ...n, sharedNotes: data.sharedNotes ?? '', privateNotes: data.privateNotes ?? '' }));
    setRoll(Object.fromEntries(data.roster.filter((r) => r.status).map((r) => [r.id, r.status!])));
  }, [data]);
  // Only students marked present or late take part; before the register is taken, everyone does.
  const inClass = (data?.roster ?? []).filter((r) => Object.keys(roll).length === 0 || roll[r.id] === 'present' || roll[r.id] === 'late');
  const pick = () => {
    const pool = inClass.filter((r) => !usedPicks.includes(r.id));
    const from = pool.length ? pool : inClass;
    const next = from[Math.floor(Math.random() * from.length)];
    if (!next) return;
    setPicked(next.displayName); setUsedPicks(pool.length ? [...usedPicks, next.id] : [next.id]);
  };
  const makeTeams = (size: number) => {
    const names = shuffle(inClass.map((r) => r.displayName));
    const n = Math.max(1, Math.round(names.length / size));
    const out: string[][] = Array.from({ length: n }, () => []);
    names.forEach((nm, i) => out[i % n]!.push(nm));
    setTeamSize(size); setTeams(out);
  };
  const cycle: Att[] = ['present', 'late', 'absent', 'excused'];
  const saveRoll = async (next: Record<string, Att>) => {
    setRoll(next);
    try { await api(`/sessions/${id}/attendance`, { method: 'PUT', body: { records: Object.entries(next).map(([studentId, status]) => ({ studentId, status })) } }); }
    catch (e) { setErr((e as Error).message); }
  };
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
        {tool && (
          <div className="tool-overlay" role="dialog" aria-label="Class tool">
            {tool === 'pick' && <div className="stack" style={{ justifyItems: 'center' }}>
              <div className="picked" aria-live="assertive">{picked ?? 'Ready?'}</div>
              <div className="row"><button className="btn on" onClick={pick}>{picked ? 'Pick again' : 'Pick a student'}</button><button className="btn" onClick={() => setTool(null)}>Close</button></div>
              <span className="small" style={{ opacity: .7 }}>Nobody is picked twice until everyone has had a turn. {inClass.length} in class.</span>
            </div>}
            {tool === 'teams' && <div className="stack" style={{ justifyItems: 'center', width: '100%' }}>
              <div className="row">{[2, 3, 4].map((n) => <button key={n} className={`btn ${teamSize === n && teams.length ? 'on' : ''}`} onClick={() => makeTeams(n)}>{n === 2 ? 'Pairs' : `Groups of ${n}`}</button>)}<button className="btn" onClick={() => setTool(null)}>Close</button></div>
              <div className="teams">{teams.map((t, i) => <div key={i} className="team"><h3>{teamSize === 2 ? 'Pair' : 'Group'} {i + 1}</h3>{t.map((nm) => <div key={nm}>{nm}</div>)}</div>)}</div>
            </div>}
            {tool === 'roll' && <div className="stack" style={{ justifyItems: 'center', width: '100%' }}>
              <h2 style={{ fontSize: '2rem' }}>Register — tap to change</h2>
              <div className="roll">{(data.roster).map((r) => (
                <button key={r.id} data-s={roll[r.id] ?? ''} onClick={() => saveRoll({ ...roll, [r.id]: cycle[(cycle.indexOf(roll[r.id] ?? 'excused') + 1) % cycle.length]! })}>
                  {r.displayName}<span className="small">{roll[r.id] ?? 'not taken'}</span>
                </button>))}</div>
              <div className="row"><button className="btn" onClick={() => saveRoll(Object.fromEntries(data.roster.map((r) => [r.id, 'present' as Att])))}>Everyone present</button><button className="btn on" onClick={() => setTool(null)}>Done</button></div>
            </div>}
          </div>
        )}
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
          <button className="btn" onClick={() => setTool(tool === 'roll' ? null : 'roll')}>Register</button>
          <button className="btn" onClick={() => { setTool(tool === 'pick' ? null : 'pick'); }}>Pick</button>
          <button className="btn" onClick={() => { setTool(tool === 'teams' ? null : 'teams'); if (!teams.length) makeTeams(2); }}>Groups</button>
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
