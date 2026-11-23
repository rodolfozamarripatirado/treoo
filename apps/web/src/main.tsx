import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { SessionProvider, useSession } from './session';
import { Login } from './pages/Login';
import { Prepare } from './pages/Prepare';
import { Capture } from './pages/Capture';
import { LessonEditor } from './pages/LessonEditor';
import { LessonPreview } from './pages/LessonPreview';
import { Classes, ClassDetail } from './pages/Classes';
import { Present } from './pages/Present';
import { Groups, GroupDetail } from './pages/Groups';
import { People } from './pages/People';
import { Progress } from './pages/Progress';
import { MyClasses, MyClass, MyTasks, MyProgress } from './pages/Student';
import { Today } from './pages/Today';
import { StudentProfile } from './pages/StudentProfile';
import { LessonPrint } from './pages/LessonPrint';
import { VocabLab } from './pages/VocabLab';

function Home() {
  const { me } = useSession();
  const role = me?.active?.role;
  if (!role) return <div className="sheet"><h1>No academy yet</h1><p>Your account is not linked to an academy. Ask your academy administrator to add you.</p></div>;
  return <Navigate to={role === 'student' ? '/me' : '/today'} replace />;
}

function App() {
  const { me, loading } = useSession();
  if (loading) return <main className="page"><Loading /></main>;
  if (!me) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/classes/:id/present" element={<Present />} />
      <Route path="/lessons/:id/print" element={<LessonPrint />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/today" element={<Today />} />
        <Route path="/students/:id" element={<StudentProfile />} />
        <Route path="/me/vocab" element={<VocabLab />} />
        <Route path="/prepare" element={<Prepare />} />
        <Route path="/prepare/capture" element={<Capture />} />
        <Route path="/lessons/new" element={<LessonEditor />} />
        <Route path="/lessons/:id" element={<LessonEditor />} />
        <Route path="/lessons/:id/preview" element={<LessonPreview />} />
        <Route path="/classes" element={<Classes />} />
        <Route path="/classes/:id" element={<ClassDetail />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/:id" element={<GroupDetail />} />
        <Route path="/people" element={<People />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/me" element={<MyClasses />} />
        <Route path="/me/classes/:id" element={<MyClass />} />
        <Route path="/me/tasks" element={<MyTasks />} />
        <Route path="/me/progress" element={<MyProgress />} />
        <Route path="*" element={<div className="sheet"><h1>Page not found</h1><p><a href="/">Go to your start page</a></p></div>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><SessionProvider><App /></SessionProvider></BrowserRouter></StrictMode>,
);
