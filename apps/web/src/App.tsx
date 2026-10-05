import { Navigate, Route, Routes } from 'react-router-dom';
import { useMe } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/common';
import { LoginPage } from './pages/Login';
import { ContestListPage } from './pages/ContestList';
import { ContestHomePage } from './pages/ContestHome';
import { ProblemPage } from './pages/Problem';
import { MySubmissionsPage } from './pages/MySubmissions';
import { SubmissionPage } from './pages/Submission';
import { ScoreboardPage } from './pages/Scoreboard';
import { AdminContestsPage } from './pages/admin/Contests';
import { AdminContestPage } from './pages/admin/Contest';
import { AdminProblemPage } from './pages/admin/Problem';
import { AdminUsersPage } from './pages/admin/Users';
import { AdminSubmissionsPage } from './pages/admin/Submissions';
import { AdminQueuePage } from './pages/admin/Queue';
import type { ReactNode } from 'react';

function RequireUser({ admin, children }: { admin?: boolean; children: ReactNode }) {
  const { data, isLoading } = useMe();
  if (isLoading) return <Spinner className="mt-24" />;
  if (!data?.user) return <Navigate to="/login" replace />;
  if (admin && data.user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Home() {
  const { data } = useMe();
  if (data?.user?.role === 'ADMIN') return <Navigate to="/admin" replace />;
  return <ContestListPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Scoreboards may be public (e.g. for a projector) when the contest allows it. */}
      <Route path="/board/:cid" element={<ScoreboardPage standalone />} />
      <Route element={<Layout />}>
        <Route path="/" element={<RequireUser><Home /></RequireUser>} />
        <Route path="/c/:cid" element={<RequireUser><ContestHomePage /></RequireUser>} />
        <Route path="/c/:cid/p/:pid" element={<RequireUser><ProblemPage /></RequireUser>} />
        <Route path="/c/:cid/submissions" element={<RequireUser><MySubmissionsPage /></RequireUser>} />
        <Route path="/c/:cid/scoreboard" element={<ScoreboardPage />} />
        <Route path="/s/:sid" element={<RequireUser><SubmissionPage /></RequireUser>} />
        <Route path="/admin" element={<RequireUser admin><AdminContestsPage /></RequireUser>} />
        <Route path="/admin/contests/:cid" element={<RequireUser admin><AdminContestPage /></RequireUser>} />
        <Route path="/admin/problems/:pid" element={<RequireUser admin><AdminProblemPage /></RequireUser>} />
        <Route path="/admin/users" element={<RequireUser admin><AdminUsersPage /></RequireUser>} />
        <Route path="/admin/submissions" element={<RequireUser admin><AdminSubmissionsPage /></RequireUser>} />
        <Route path="/admin/queue" element={<RequireUser admin><AdminQueuePage /></RequireUser>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
