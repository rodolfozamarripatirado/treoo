import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../session';
import { Logo } from './ui';

const NAV = {
  teacher: [['/today', 'Today'], ['/prepare', 'Prepare'], ['/classes', 'Classes'], ['/groups', 'Groups'], ['/progress', 'Progress']],
  admin: [['/today', 'Today'], ['/groups', 'Groups'], ['/people', 'People'], ['/prepare', 'Lessons'], ['/classes', 'Classes'], ['/progress', 'Progress']],
  student: [['/me', 'My classes'], ['/me/vocab', 'Vocabulary'], ['/me/tasks', 'Tasks'], ['/me/progress', 'My progress']],
} as const;

function AcademySwitch({ className }: { className?: string }) {
  const { me, switchAcademy } = useSession();
  if (!me || me.memberships.length < 2) return <span className={`${className ?? ''} academy-name small`}>{me?.memberships[0]?.academyName}</span>;
  return (
    <select className={className} aria-label="Academy" value={me.active?.academyId ?? ''} onChange={async (e) => { await switchAcademy(e.target.value); window.location.assign('/'); }}>
      {me.memberships.map((m) => <option key={m.academyId} value={m.academyId}>{m.academyName} — {m.role}</option>)}
    </select>
  );
}

export function Shell() {
  const { me, logout } = useSession();
  const role = me?.active?.role ?? 'student';
  return (
    <div className="shell">
      <header className="topbar-mobile"><span className="row"><Logo size={24} /><strong>Treoo</strong></span><AcademySwitch className="academy-switch" /></header>
      <nav className="rail" aria-label="Main">
        <a className="brand" href="/"><Logo />Treoo</a>
        <AcademySwitch className="academy-switch" />
        <div className="nav">
          {NAV[role].map(([to, label]) => <NavLink key={to} to={to} end={to === '/me'}>{label}</NavLink>)}
        </div>
        <div className="rail-foot">
          <div>{me?.user.displayName}</div>
          <button onClick={async () => { await logout(); window.location.assign('/login'); }}>Sign out</button>
        </div>
      </nav>
      <main className="page" id="main"><Outlet /></main>
    </div>
  );
}
