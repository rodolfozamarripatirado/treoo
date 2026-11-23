import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtMinutes, type Activity } from '../api';

export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#FFE45C" /><path d="M7 22h6v-6h6v-6h6" fill="none" stroke="#1B2340" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** The lesson drawn to scale: each segment's width is its share of the class time. */
export function RouteBar({ activities, current, showMeta = true }: { activities: Pick<Activity, 'title' | 'durationMinutes'>[]; current?: number; showMeta?: boolean }) {
  const known = activities.reduce((s, a) => s + (a.durationMinutes ?? 0), 0);
  const unknown = activities.filter((a) => a.durationMinutes == null).length;
  return (
    <div className="route-wrap">
      <div className="route-bar" role="img" aria-label={`${activities.length} activities, ${fmtMinutes(known)} planned${unknown ? `, ${unknown} without a time` : ''}`}>
        {activities.map((a, i) => (
          <span key={i} title={`${a.title || 'Untitled activity'}${a.durationMinutes ? ` · ${fmtMinutes(a.durationMinutes)}` : ''}`}
            className={[a.durationMinutes == null ? 'unknown' : '', i === current ? 'now' : ''].join(' ')}
            style={a.durationMinutes != null ? { flex: `${a.durationMinutes} 1 0` } : undefined} />
        ))}
      </div>
      {showMeta && (
        <div className="route-meta">
          <span>{activities.length} {activities.length === 1 ? 'activity' : 'activities'}</span>
          <span>{fmtMinutes(known)} planned{unknown ? ` + ${unknown} without a time` : ''}</span>
        </div>
      )}
    </div>
  );
}

export const ErrorNote = ({ msg }: { msg: string | null | undefined }) => msg ? <div className="notice error" role="alert"><p>{msg}</p></div> : null;

export function Loading({ what = 'Loading' }: { what?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 200); return () => clearTimeout(t); }, []);
  return show ? <p className="muted" aria-live="polite">{what}…</p> : null;
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); }, [msg]);
  return { toast: setMsg, node: msg ? <div className="toast" role="status">{msg}</div> : null };
}

export function Dialog({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return <dialog ref={ref} onClose={onClose} aria-label={label}>{open && children}</dialog>;
}

export const StatusPill = ({ status }: { status: string }) => <span className={`pill ${status}`}>{status[0]!.toUpperCase() + status.slice(1)}</span>;
export const AiPill = ({ origin }: { origin: string | null }) =>
  origin === 'mock' ? <span className="pill sim" title="Created from simulated AI output">Simulated AI</span>
  : origin ? <span className="pill" title="Started from an AI proposal">AI-assisted</span> : null;
