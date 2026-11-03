import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import { apiClient } from './api/client';

vi.mock('./api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  setAuthToken: vi.fn(),
  onUnauthorized: vi.fn(() => () => {}),
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('sends an unauthenticated visitor to the login page instead of the overview', () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByLabelText('Логин')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Все проекты' })).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('renders the home page with nav at / for a logged-in user', () => {
    localStorage.setItem('accessToken', 'tok123');
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Единый центр отчетности FD Agency' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Все проекты' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Compare' })).not.toBeInTheDocument();
  });

  it('renders the projects list at /projects', async () => {
    localStorage.setItem('accessToken', 'tok123');
    (apiClient.get as any).mockResolvedValue({ data: [] });
    window.history.pushState({}, '', '/projects');
    render(<App />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/profiles'));
  });
});
