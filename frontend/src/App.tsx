import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AuthShell } from './components/AuthShell';
import { Layout } from './components/Layout';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { ComparePage } from './pages/ComparePage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';

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
              <Layout>
                <OverviewPage />
              </Layout>
            }
          />
          <Route
            path="/accounts/:id"
            element={
              <Layout>
                <AccountDetailPage />
              </Layout>
            }
          />
          <Route
            path="/compare"
            element={
              <Layout>
                <ComparePage />
              </Layout>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
