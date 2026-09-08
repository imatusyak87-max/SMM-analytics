import { type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthShell } from './components/AuthShell';
import { Layout } from './components/Layout';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { ComparePage } from './pages/ComparePage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';

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
                <OverviewPage />
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
          <Route
            path="/compare"
            element={
              <RequireAuth>
                <ComparePage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
