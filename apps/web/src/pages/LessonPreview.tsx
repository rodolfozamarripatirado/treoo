import { Link, useParams } from 'react-router-dom';
import { api, type Lesson } from '../api';
import { ErrorNote, Loading } from '../components/ui';
import { useLoad } from '../session';
import { LessonBody } from './LessonEditor';

/** DEC-A-001: preview always renders the last saved revision, never unsaved edits. */
export function LessonPreview() {
  const { id } = useParams();
  const { data, error } = useLoad(() => api<Lesson>(`/lessons/${id}`), [id]);
  if (error) return <ErrorNote msg={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <Link className="back" to={`/lessons/${id}`}>Back to editor</Link>
        <span className="muted small">Preview of saved revision {data.revision}. Not visible to students.</span>
      </div>
      <div className="sheet"><LessonBody lesson={data} showNotes /></div>
    </>
  );
}
