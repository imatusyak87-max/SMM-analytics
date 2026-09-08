import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { apiClient, setAuthToken, onUnauthorized } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: { post: vi.fn() },
  setAuthToken: vi.fn(),
  onUnauthorized: vi.fn(() => () => {}),
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

  it('drops an expired session so the guard sends the user back to login', async () => {
    localStorage.setItem('accessToken', 'expired-tok');
    render(<AuthProvider><Consumer /></AuthProvider>);
    expect(screen.getByText('expired-tok')).toBeInTheDocument();

    const rejectSession = (onUnauthorized as any).mock.calls[0][0];
    await act(async () => rejectSession());

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(screen.getByText('no-token')).toBeInTheDocument();
  });

  it('stores the token returned by /auth/login', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { accessToken: 'tok123' } });
    render(<AuthProvider><Consumer /></AuthProvider>);

    fireEvent.click(screen.getByText('go'));

    await waitFor(() => expect(screen.getByText('tok123')).toBeInTheDocument());
  });
});
