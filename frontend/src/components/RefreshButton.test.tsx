import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RefreshButton } from './RefreshButton';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));

describe('RefreshButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tells the user when the sync request could not be started', async () => {
    (apiClient.post as any).mockRejectedValue({
      response: { data: { message: 'Queue unavailable' } },
    });
    render(<RefreshButton accountId="acc-1" />);

    fireEvent.click(screen.getByText('Обновить'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Queue unavailable'));
  });

  it('shows the job status once the sync has been queued', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    render(<RefreshButton accountId="acc-1" />);

    fireEvent.click(screen.getByText('Обновить'));

    await waitFor(() => expect(screen.getByText('pending')).toBeInTheDocument());
  });
});
