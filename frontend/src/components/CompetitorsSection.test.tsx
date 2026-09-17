import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

  it('explains a failed run and keeps the old suggestions visible', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        ...payload,
        run: { ...payload.run, status: 'failed', errorMessage: 'Превышен лимит запросов, попробуйте позже' },
      },
    });

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('Превышен лимит запросов');
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
});
