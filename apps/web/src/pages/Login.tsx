import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Logo, RouteBar } from '../components/ui';
import { useSession } from '../session';

const DEMO = import.meta.env.VITE_DEMO !== 'false';
const ACCOUNTS: [string, string][] = [
  ['ana@northbridge.demo', 'Ana — teacher (two academies)'],
  ['olivia@northbridge.demo', 'Olivia — academy admin'],
  ['sam@northbridge.demo', 'Sam — student'],
  ['bruno@westport.demo', 'Bruno — teacher at another academy'],
];

export function Login() {
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api('/auth/login', { body: { email, password } }); await refresh(); window.history.replaceState(null, '', '/'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <section className="login-art">
        <div className="row"><Logo size={34} /><strong style={{ fontFamily: 'var(--display)', fontSize: '1.5rem' }}>Treoo</strong></div>
        <div>
          <h1>Every step, with direction.</h1>
          <RouteBar showMeta={false} activities={[{ title: 'Warm-up', durationMinutes: 10 }, { title: 'Presentation', durationMinutes: 20 }, { title: 'Practice', durationMinutes: 15 }, { title: 'Speaking', durationMinutes: 15 }]} current={1} />
          <p>Prepare a class from a photo of a worksheet, teach it, and keep every lesson easy to find — by date or by topic.</p>
        </div>
        <p className="small">For in-person English academies.</p>
      </section>
      <section className="login-form">
        <form onSubmit={submit} className="stack" noValidate>
          <h2>Sign in</h2>
          {error && <div className="notice error" role="alert"><p>{error}</p></div>}
          <label className="field">Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {DEMO && (
            <div className="demo-accounts">
              <p className="muted">Demo accounts with fictitious data. Password: <code>Treoo-demo-2026</code></p>
              {ACCOUNTS.map(([em, label]) => (
                <div key={em}><button type="button" onClick={() => { setEmail(em); setPassword('Treoo-demo-2026'); }}>{label}</button></div>
              ))}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
