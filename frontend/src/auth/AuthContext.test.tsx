import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { apiClient, setAuthToken } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: { post: vi.fn() },
  setAuthToken: vi.fn(),
}));

function Consumer() {
  const { token, login } = useAuth();
  return (
    <div>
      <span>{token ?? 'no-token'}</span>
      <button onClick={() => login('a@b.com', 'password123')}>go</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('restores the Authorization header from a token persisted by an earlier session', () => {
    localStorage.setItem('accessToken', 'stored-tok');

    render(<AuthProvider><Consumer /></AuthProvider>);

    expect(setAuthToken).toHaveBeenCalledWith('stored-tok');
  });

  it('stores the token returned by /auth/login', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { accessToken: 'tok123' } });
    render(<AuthProvider><Consumer /></AuthProvider>);

    fireEvent.click(screen.getByText('go'));

    await waitFor(() => expect(screen.getByText('tok123')).toBeInTheDocument());
  });
});
