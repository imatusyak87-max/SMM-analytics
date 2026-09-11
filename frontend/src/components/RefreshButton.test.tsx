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

  it('tells the page to reload once the sync succeeds', async () => {
    vi.useFakeTimers();
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({ data: { id: 'job-1', status: 'success' } });
    const onSynced = vi.fn();
    render(<RefreshButton accountId="acc-1" onSynced={onSynced} />);

    fireEvent.click(screen.getByText('Обновить'));
    await vi.advanceTimersByTimeAsync(2500);
    vi.useRealTimers();

    expect(onSynced).toHaveBeenCalled();
  });

  it('explains in Russian that Telegram hides the channel posts when that is why the sync failed', async () => {
    vi.useFakeTimers();
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({
      data: {
        id: 'job-1',
        status: 'failed',
        errorMessage:
          'No posts found on the preview page for ehinaceya — the channel may have disabled its web preview, or Telegram changed the page markup.',
      },
    });
    render(<RefreshButton accountId="acc-1" />);

    fireEvent.click(screen.getByText('Обновить'));
    await vi.advanceTimersByTimeAsync(2500);
    vi.useRealTimers();

    expect(screen.getByRole('alert')).toHaveTextContent('Telegram не показывает посты этого канала');
  });

  it('shows the stored error text of a failed sync it has no translation for', async () => {
    vi.useFakeTimers();
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({
      data: { id: 'job-1', status: 'failed', errorMessage: 'Account acc-1 not found' },
    });
    render(<RefreshButton accountId="acc-1" />);

    fireEvent.click(screen.getByText('Обновить'));
    await vi.advanceTimersByTimeAsync(2500);
    vi.useRealTimers();

    expect(screen.getByRole('alert')).toHaveTextContent('Account acc-1 not found');
  });

  it('shows the job status once the sync has been queued', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    render(<RefreshButton accountId="acc-1" />);

    fireEvent.click(screen.getByText('Обновить'));

    await waitFor(() => expect(screen.getByText('pending')).toBeInTheDocument());
  });

  it('stops polling after a second click, rather than leaving an orphaned poller running forever', async () => {
    vi.useFakeTimers();
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({ data: { id: 'job-1', status: 'success' } });
    render(<RefreshButton accountId="acc-1" />);

    fireEvent.click(screen.getByText('Обновить'));
    fireEvent.click(screen.getByText('Обновить'));
    await vi.advanceTimersByTimeAsync(2500);

    const callsOnceFinished = (apiClient.get as any).mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    vi.useRealTimers();

    expect((apiClient.get as any).mock.calls.length).toBe(callsOnceFinished);
  });

  it('still reports success after a second click', async () => {
    vi.useFakeTimers();
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({ data: { id: 'job-1', status: 'success' } });
    const onSynced = vi.fn();
    render(<RefreshButton accountId="acc-1" onSynced={onSynced} />);

    fireEvent.click(screen.getByText('Обновить'));
    fireEvent.click(screen.getByText('Обновить'));
    await vi.advanceTimersByTimeAsync(2500);
    vi.useRealTimers();

    expect(onSynced).toHaveBeenCalled();
    expect(screen.getByText('success')).toBeInTheDocument();
  });

  it('queues only one sync when the button is clicked twice in a row', async () => {
    vi.useFakeTimers();
    (apiClient.post as any).mockResolvedValue({ data: { id: 'job-1', status: 'pending' } });
    (apiClient.get as any).mockResolvedValue({ data: { id: 'job-1', status: 'success' } });
    render(<RefreshButton accountId="acc-1" />);

    fireEvent.click(screen.getByText('Обновить'));
    fireEvent.click(screen.getByText('Обновить'));
    await vi.advanceTimersByTimeAsync(2500);
    vi.useRealTimers();

    expect((apiClient.post as any).mock.calls.length).toBe(1);
  });
});
