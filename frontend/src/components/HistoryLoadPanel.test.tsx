import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HistoryLoadPanel } from './HistoryLoadPanel';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;

const load = (overrides = {}) => ({
  status: 'running',
  phase: 'posts',
  postsLoaded: 0,
  oldestPostAt: null,
  insightsDone: 0,
  insightsTotal: 0,
  pausedUntil: null,
  pauseReason: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

async function renderPanel(onFinished = vi.fn()) {
  render(<HistoryLoadPanel accountId="acc-1" onFinished={onFinished} />);
  await act(async () => {});
  return onFinished;
}

describe('HistoryLoadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it('offers to load everything when no load has run', async () => {
    get.mockResolvedValue({ data: '' });
    await renderPanel();

    expect(get).toHaveBeenCalledWith('/accounts/acc-1/history-load');
    expect(screen.getByRole('button', { name: 'Загрузить все посты' })).toBeInTheDocument();
    expect(screen.getByText('Один раз загрузит все посты аккаунта. Может занять от минут до нескольких часов.')).toBeInTheDocument();
  });

  it('starts a load and shows its progress', async () => {
    get.mockResolvedValue({ data: '' });
    post.mockResolvedValue({ data: load({ status: 'queued' }) });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Загрузить все посты' }));
    });

    expect(post).toHaveBeenCalledWith('/accounts/acc-1/history-load');
    expect(screen.getByText('Загружаем историю: 0 постов')).toBeInTheDocument();
  });

  it('shows posts loaded and how far back the load has reached', async () => {
    get.mockResolvedValue({ data: load({ postsLoaded: 1241, oldestPostAt: '2024-03-15T10:00:00.000Z' }) });
    await renderPanel();

    expect(screen.getByText('Загружаем историю: 1241 пост, дошли до марта 2024')).toBeInTheDocument();
  });

  it('polls every 5 seconds while running and reports completion once', async () => {
    get
      .mockResolvedValueOnce({ data: load({ postsLoaded: 20 }) })
      .mockResolvedValue({ data: load({ status: 'done', postsLoaded: 2314, oldestPostAt: '2019-03-12T10:00:00.000Z' }) });
    const onFinished = await renderPanel();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('Вся история загружена: 2314 постов с 12.03.2019')).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not report completion for a load that was already done on arrival', async () => {
    get.mockResolvedValue({ data: load({ status: 'done', postsLoaded: 5 }) });
    const onFinished = await renderPanel();
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Обновить всю историю' })).toBeInTheDocument();
  });

  it('shows insight progress in the Instagram phase', async () => {
    get.mockResolvedValue({ data: load({ phase: 'insights', insightsDone: 340, insightsTotal: 1200 }) });
    await renderPanel();
    expect(screen.getByText('Досчитываем охваты: 340 из 1200')).toBeInTheDocument();
  });

  it('explains an Instagram pause with the resume time and polls once a minute', async () => {
    const until = new Date(2026, 8, 28, 14, 30);
    get.mockResolvedValue({ data: load({ status: 'paused', postsLoaded: 10, pauseReason: 'instagram_rate_limit', pausedUntil: until.toISOString() }) });
    await renderPanel();

    expect(screen.getByText('Пауза: лимит запросов Instagram, продолжим в 14:30')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('explains a Telegram pause in minutes', async () => {
    get.mockResolvedValue({ data: load({ status: 'paused', pauseReason: 'telegram_rate_limit', pausedUntil: new Date(Date.now() + 5 * 60_000).toISOString() }) });
    await renderPanel();
    expect(screen.getByText('Telegram ограничил запросы, продолжим через 5 минут')).toBeInTheDocument();
  });

  it('shows the failure and continues from where it stopped', async () => {
    get.mockResolvedValue({ data: load({ status: 'failed', errorMessage: 'Instagram отклонил доступ, нужно переподключить аккаунт' }) });
    post.mockResolvedValue({ data: load({ status: 'queued', postsLoaded: 300 }) });
    await renderPanel();

    expect(screen.getByText('Не удалось загрузить историю: Instagram отклонил доступ, нужно переподключить аккаунт')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    });
    expect(post).toHaveBeenCalledWith('/accounts/acc-1/history-load');
  });

  it('shows why a start was refused', async () => {
    get.mockResolvedValue({ data: '' });
    post.mockRejectedValue({ response: { data: { message: 'Для этой платформы загрузка истории недоступна' } } });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Загрузить все посты' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Для этой платформы загрузка истории недоступна');
  });
});
