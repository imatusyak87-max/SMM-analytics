import { createContext, useContext, useState, type ReactNode } from 'react';
import { apiClient, setAuthToken } from '../api/client';

interface AuthValue {
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Set synchronously during the first render, not in an effect: child effects
  // run before the parent's, so an effect here would fire after pages have
  // already sent their first (unauthenticated) requests.
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem('accessToken');
    if (stored) setAuthToken(stored);
    return stored;
  });

  async function login(email: string, password: string) {
    const { data } = await apiClient.post('/auth/login', { email, password });
    localStorage.setItem('accessToken', data.accessToken);
    setAuthToken(data.accessToken);
    setToken(data.accessToken);
  }

  function logout() {
    localStorage.removeItem('accessToken');
    setAuthToken(null);
    setToken(null);
  }

  return <AuthContext.Provider value={{ token, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
