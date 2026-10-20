import { type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthShell } from './components/AuthShell';
import { Layout } from './components/Layout';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { GuidePage } from './pages/GuidePage';
import { HomePage } from './pages/HomePage';
import { LegacyProfileRedirect } from './pages/LegacyProfileRedirect';
import { LoginPage } from './pages/LoginPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProfilePage } from './pages/ProfilePage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthShell>
                <LoginPage />
              </AuthShell>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/projects"
            element={
              <RequireAuth>
                <ProjectsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/profiles/:id"
            element={
              <RequireAuth>
                <LegacyProfileRedirect />
              </RequireAuth>
            }
          />
          <Route
            path="/guide"
            element={
              <RequireAuth>
                <GuidePage />
              </RequireAuth>
            }
          />
          <Route
            path="/accounts/:id"
            element={
              <RequireAuth>
                <AccountDetailPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
