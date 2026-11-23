import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, Loading } from '../components/ui';
import { useLoad } from '../session';

interface Row { id: string; name: string; level: string | null; teacherName: string | null; students: number; classesDelivered: number; attendanceRate: number | null; avgScore: number | null }

const Meter = ({ v }: { v: number | null }) => v == null ? <span className="muted">—</span> : (
  <span className="row" style={{ flexWrap: 'nowrap' }}><span className="meter" aria-hidden="true"><span style={{ width: `${v}%` }} /></span>{v}%</span>
);

export function Progress() {
  const { data, error } = useLoad(() => api<Row[]>('/progress/overview'), []);
  return (
    <>
      <div className="page-head"><div><h1>Progress</h1><p className="muted">Attendance and task results per group. Open a group for the detail by student and topic.</p></div></div>
      <ErrorNote msg={error} />
      {!data ? <Loading /> : data.length === 0 ? <p className="muted">No groups yet.</p> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Group</th><th>Teacher</th><th>Students</th><th>Classes taught</th><th>Attendance</th><th>Task average</th></tr></thead>
          <tbody>{data.map((g) => (
            <tr key={g.id}><td><Link to={`/groups/${g.id}`}>{g.name}</Link>{g.level && <span className="muted small"> {g.level}</span>}</td><td>{g.teacherName ?? '—'}</td><td>{g.students}</td><td>{g.classesDelivered}</td><td><Meter v={g.attendanceRate} /></td><td><Meter v={g.avgScore} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>Differences between groups depend on level, size and tasks set. They are not a measure of teaching quality.</p>
    </>
  );
}
