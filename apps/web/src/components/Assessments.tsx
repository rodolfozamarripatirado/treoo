import { fmtDate } from '../api';

export type SkillScores = Partial<Record<'reading' | 'listening' | 'speaking' | 'writing' | 'grammar', { score: number; max: number }>>;
export interface Assessment { id: string; kind: 'baseline' | 'checkpoint' | 'final' | 'quiz'; takenOn: string; instrument: string | null; scores: SkillScores; cefr: string | null; strengths: string | null; nextSteps: string | null; assessorName?: string; sharedWithStudent?: boolean }
export const SKILLS = ['reading', 'listening', 'speaking', 'writing', 'grammar'] as const;
const KIND = { baseline: 'Starting point', checkpoint: 'Checkpoint', final: 'Final assessment', quiz: 'Quiz' } as const;
const pct = (s?: { score: number; max: number }) => (s ? Math.round((100 * s.score) / s.max) : null);

/** Skills side by side across assessments, so progress from the starting point is visible at a glance. */
export function AssessmentList({ items, onDelete }: { items: Assessment[]; onDelete?: (id: string) => void }) {
  if (!items.length) return <p className="muted">No assessments yet.</p>;
  const baseline = [...items].reverse().find((a) => a.kind === 'baseline');
  return (
    <div className="stack">
      {items.map((a) => (
        <article key={a.id} className="sheet stack" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><strong>{KIND[a.kind]}</strong><span className="muted small"> {fmtDate(a.takenOn)}{a.instrument ? `, ${a.instrument}` : ''}</span></div>
            <span className="row">{a.cefr && <span className="pill ready" title="Estimate from this assessment, not an official certificate">CEFR {a.cefr} (estimate)</span>}{a.sharedWithStudent === false && <span className="pill">Private</span>}{onDelete && <button className="btn quiet" onClick={() => onDelete(a.id)}>Delete</button>}</span>
          </div>
          <div className="skills">
            {SKILLS.filter((k) => a.scores[k]).map((k) => {
              const p = pct(a.scores[k])!; const b = a !== baseline ? pct(baseline?.scores[k]) : null;
              return (
                <div key={k} className="skill">
                  <span className="small">{k[0]!.toUpperCase() + k.slice(1)}</span>
                  <div className="meter"><span style={{ width: `${p}%` }} /></div>
                  <span className="small">{a.scores[k]!.score}/{a.scores[k]!.max}{b != null && p !== b ? <span className={p > b ? 'up' : 'down'}> {p > b ? '+' : ''}{p - b} vs start</span> : ''}</span>
                </div>
              );
            })}
          </div>
          {a.strengths && <p className="small" style={{ margin: 0 }}><strong>Strengths:</strong> {a.strengths}</p>}
          {a.nextSteps && <p className="small" style={{ margin: 0 }}><strong>Next steps:</strong> {a.nextSteps}</p>}
        </article>
      ))}
    </div>
  );
}
