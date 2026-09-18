import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitorsSection } from './CompetitorsSection';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const payload = {
  enabled: true,
  run: { id: 'run-1', status: 'success', niche: 'SMM', errorMessage: null, finishedAt: '2026-09-17T10:00:00Z' },
  suggestions: [
    {
      externalId: 'rival',
      name: 'Конкурент',
      followersCount: 4800,
      reason: 'Та же тема',
      fit: 9,
      rank: 1,
      alreadyTracked: false,
      trackedAccountId: null,
    },
    {
      externalId: 'tracked',
      name: 'Уже добавленный',
      followersCount: 3000,
      reason: 'Смежная тема',
      fit: 7,
      rank: 2,
      alreadyTracked: true,
      trackedAccountId: 'acc-9',
    },
  ],
};

function renderSection() {
  return render(
    <MemoryRouter>
      <CompetitorsSection accountId="acc-1" />
    </MemoryRouter>,
  );
}

describe('CompetitorsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the niche, when it was updated, and each suggestion', async () => {
    (apiClient.get as any).mockResolvedValue({ data: payload });

    renderSection();

    expect(await screen.findByText(/SMM/)).toBeInTheDocument();
    expect(screen.getByText(/обновлено/)).toBeInTheDocument();
    expect(screen.getByText('Конкурент')).toBeInTheDocument();
    expect(screen.getByText('Та же тема')).toBeInTheDocument();
  });

  it('offers to add a suggestion that is not tracked and marks the one that is', async () => {
    (apiClient.get as any).mockResolvedValue({ data: payload });

    renderSection();

    expect(await screen.findByRole('button', { name: 'Добавить' })).toBeInTheDocument();
    expect(screen.getByText('Уже отслеживается')).toBeInTheDocument();
  });

  it('adds a channel by its t.me link and reloads the list', async () => {
    (apiClient.get as any).mockResolvedValue({ data: payload });
    (apiClient.post as any).mockResolvedValue({ data: { id: 'acc-new' } });

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить' }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/accounts/from-link', { link: 'https://t.me/rival' }),
    );
  });

  it('says nothing was found when a successful run produced no suggestions', async () => {
    (apiClient.get as any).mockResolvedValue({ data: { ...payload, suggestions: [] } });

    renderSection();

    expect(await screen.findByText('Не нашли похожих каналов')).toBeInTheDocument();
  });

  it('shows the fixed Russian failure message and never the raw backend error', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        ...payload,
        run: {
          ...payload.run,
          status: 'failed',
          errorMessage: 'Gemini не ответил: timeout of 120000ms exceeded',
        },
      },
    });

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подобрать конкурентов');
    expect(screen.queryByText(/timeout of 120000ms exceeded/)).not.toBeInTheDocument();
    expect(screen.getByText('Конкурент')).toBeInTheDocument();
  });

  it('polls while a run is in progress and stops when it succeeds', async () => {
    vi.useFakeTimers();
    (apiClient.get as any)
      .mockResolvedValueOnce({ data: { ...payload, run: { ...payload.run, status: 'running' }, suggestions: [] } })
      .mockResolvedValue({ data: payload });

    renderSection();
    await vi.advanceTimersByTimeAsync(5500);
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByText('Конкурент')).toBeInTheDocument());
  });

  it('disables the button and explains when the feature is not configured', async () => {
    (apiClient.get as any).mockResolvedValue({ data: { enabled: false, run: null, suggestions: [] } });

    renderSection();

    expect(await screen.findByRole('button', { name: 'Обновить конкурентов' })).toBeDisabled();
    expect(screen.getByText('Подбор конкурентов не настроен')).toBeInTheDocument();
  });

  it('does not arm a poller after the component unmounts while the initial fetch is still in flight', async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: { data: typeof payload }) => void;
    (apiClient.get as any).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const { unmount } = renderSection();
    unmount();

    resolveFirst!({ data: { ...payload, run: { ...payload.run, status: 'running' }, suggestions: [] } });
    await vi.advanceTimersByTimeAsync(15000);
    vi.useRealTimers();

    expect((apiClient.get as any).mock.calls.length).toBe(1);
  });

  it('stops polling the old account when accountId changes, and never polls it again', async () => {
    vi.useFakeTimers();
    (apiClient.get as any).mockResolvedValueOnce({
      data: { ...payload, run: { ...payload.run, status: 'running' }, suggestions: [] },
    });

    const { rerender } = render(
      <MemoryRouter>
        <CompetitorsSection accountId="acc-1" />
      </MemoryRouter>,
    );
    await vi.advanceTimersByTimeAsync(0);

    // acc-2's own initial fetch is also "running", so its own load() takes the
    // arm branch (not the disarm-on-settle branch) — it must not be blocked from
    // arming its own poller by a stale acc-1 interval sitting in the same ref.
    (apiClient.get as any).mockResolvedValue({
      data: { ...payload, run: { ...payload.run, status: 'running' }, suggestions: [] },
    });
    rerender(
      <MemoryRouter>
        <CompetitorsSection accountId="acc-2" />
      </MemoryRouter>,
    );

    await vi.advanceTimersByTimeAsync(15000);
    vi.useRealTimers();

    const callsAfterSwitch = (apiClient.get as any).mock.calls.slice(1);
    expect(callsAfterSwitch.length).toBeGreaterThan(0);
    for (const call of callsAfterSwitch) {
      expect(call[0]).toBe('/accounts/acc-2/competitors');
    }
  });

  it('still shows suggestions under StrictMode (mount -> cleanup -> mount)', async () => {
    (apiClient.get as any).mockResolvedValue({ data: payload });

    render(
      <StrictMode>
        <MemoryRouter>
          <CompetitorsSection accountId="acc-1" />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByText('Конкурент')).toBeInTheDocument();
  });
});
