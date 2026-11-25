import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './auth/AuthProvider';
import { AppLayout } from './layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DevicePage } from './pages/DevicePage';
import { DashboardPage } from './pages/DashboardPage';
import { UsagePage } from './pages/UsagePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { UsersPage } from './pages/UsersPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ModelsPage } from './pages/ModelsPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { SessionsPage } from './pages/SessionsPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';
import { MyPage } from './pages/MyPage';
import { NotFoundPage } from './pages/NotFoundPage';

function FullScreenLoader() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress />
    </Box>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?return_url=${returnUrl}`} replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/me" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/device"
        element={
          <RequireAuth>
            <DevicePage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <RequireAdmin>
              <DashboardPage />
            </RequireAdmin>
          }
        />
        <Route
          path="usage"
          element={
            <RequireAdmin>
              <UsagePage />
            </RequireAdmin>
          }
        />
        <Route
          path="approvals"
          element={
            <RequireAdmin>
              <ApprovalsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="sessions"
          element={
            <RequireAdmin>
              <SessionsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="projects"
          element={
            <RequireAdmin>
              <ProjectsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="users"
          element={
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          }
        />
        <Route
          path="channels"
          element={
            <RequireAdmin>
              <ChannelsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="models"
          element={
            <RequireAdmin>
              <ModelsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="policies"
          element={
            <RequireAdmin>
              <PoliciesPage />
            </RequireAdmin>
          }
        />
        <Route
          path="audit"
          element={
            <RequireAdmin>
              <AuditPage />
            </RequireAdmin>
          }
        />
        <Route
          path="settings"
          element={
            <RequireAdmin>
              <SettingsPage />
            </RequireAdmin>
          }
        />
        <Route path="me" element={<MyPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}