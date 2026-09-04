import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import { apiClient } from './api/client';

vi.mock('./api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  setAuthToken: vi.fn(),
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('sends an unauthenticated visitor to the login page instead of the overview', () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('renders the overview page with nav at / for a logged-in user', async () => {
    localStorage.setItem('accessToken', 'tok123');
    (apiClient.get as any).mockResolvedValue({ data: [] });
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compare' })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/stats/overview'));
  });
});
