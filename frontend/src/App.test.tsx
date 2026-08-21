import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';
import { apiClient } from './api/client';

vi.mock('./api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  setAuthToken: vi.fn(),
}));

describe('App', () => {
  it('renders the overview page with nav at /', async () => {
    (apiClient.get as any).mockResolvedValue({ data: [] });
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compare' })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/stats/overview'));
  });
});
