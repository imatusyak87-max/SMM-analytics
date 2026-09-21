import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '../auth/AuthContext';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: { post: vi.fn() },
  setAuthToken: vi.fn(),
  onUnauthorized: vi.fn(() => () => {}),
}));

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  // clearAllMocks, not resetAllMocks: resetting drops the rejection these tests set up.
  beforeEach(() => vi.clearAllMocks());

  it('submits login and password and shows the error the server sends', async () => {
    (apiClient.post as any).mockRejectedValue({ response: { data: { message: 'Invalid credentials' } } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Логин'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'));
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com', password: 'wrongpass' });
  });

  it('falls back to a Russian message when the server explains nothing', async () => {
    (apiClient.post as any).mockRejectedValue({ response: { status: 401 } });
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Неверный логин или пароль'));
  });

  it('disables the button while the login request is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    (apiClient.post as any).mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    // A second click while the first request is open would send a second login.
    const button = await screen.findByRole('button', { name: 'Входим…' });
    expect(button).toBeDisabled();

    // Success navigates away, so the button stays disabled on the way out
    // rather than briefly inviting a second login.
    release({ data: { accessToken: 'tok' } });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('clears a previous error when the next attempt starts', async () => {
    (apiClient.post as any).mockRejectedValueOnce({ response: { status: 401 } });
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('alert');

    (apiClient.post as any).mockResolvedValueOnce({ data: { accessToken: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
