import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Me } from './api';

interface SessionValue { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; switchAcademy: (id: string) => Promise<void> }
const SessionCtx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/auth/me')); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); else throw e; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setMe(null); };
  const switchAcademy = async (academyId: string) => { await api('/auth/academy', { body: { academyId } }); await refresh(); };
  return <SessionCtx.Provider value={{ me, loading, refresh, logout, switchAcademy }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}

/** Small data-loading hook with reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    fn().then((d) => alive && setData(d)).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}
