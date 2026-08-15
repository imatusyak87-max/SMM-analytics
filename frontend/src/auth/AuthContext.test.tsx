import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { apiClient } from '../api/client';

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
  it('stores the token returned by /auth/login', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { accessToken: 'tok123' } });
    render(<AuthProvider><Consumer /></AuthProvider>);

    fireEvent.click(screen.getByText('go'));

    await waitFor(() => expect(screen.getByText('tok123')).toBeInTheDocument());
  });
});
