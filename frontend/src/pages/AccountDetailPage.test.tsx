import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccountDetailPage } from './AccountDetailPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const get = apiClient.get as any;

/** Matches a formatted number regardless of which kind of space separates the thousands. */
const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;

const summary = {
  followersCount: 1000, postsCount: 2,
  totalViews: 4000, totalReactions: 200,
  avgViews: 2000, avgReactions: 100,
  erViews: 5, erFollowers: 10,
};

function detail(coverage = { postsFrom: '2026-06-12', followersFrom: '2026-06-12' }) {
  return {
    account: { id: 'acc-1', name: 'Chan' },
    latestSnapshot: { followersCount: 1000, avgEr: null },
    trend: [],
    summary,
    coverage,
  };
}

function post(id: string, caption: string) {
  return {
    id, type: 'post', caption, publishedAt: '2026-09-01T10:00:00Z',
    thumbnailUrl: null, permalink: `https://t.me/c/${id}`,
    views: 100, likes: 5, er: 0.5, erViews: 5,
  };
}

type Params = Record<string, unknown>;

function mockApi({
  detailData = detail(),
  posts = (_params: Params) => ({ total: 2, items: [post('p1', 'Hello'), post('p2', 'World')] }),
}: { detailData?: object; posts?: (params: Params) => object } = {}) {
  get.mockImplementation((url: string, config?: { params: Params }) => {
    if (url.endsWith('/detail')) return Promise.resolve({ data: detailData });
    if (url.endsWith('/posts')) return Promise.resolve({ data: posts(config!.params) });
    return Promise.resolve({ data: [] });
  });
}

const callsTo = (suffix: string): Params[] =>
  get.mock.calls
    .filter(([url]: [string]) => url.endsWith(suffix))
    .map(([, config]: [string, { params: Params }]) => config.params);

const lastCallTo = (suffix: string) => callsTo(suffix).at(-1)!;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounts/acc-1']}>
      <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date is faked, so promises and React's scheduling run normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccountDetailPage', () => {
  it('asks for the last 30 days and the top 10 by views by default', async () => {
    mockApi();
    renderPage();

    await screen.findByText('Chan');
    expect(lastCallTo('/detail')).toEqual({ from: '2026-08-13', to: '2026-09-11' });
    expect(lastCallTo('/posts')).toEqual({ from: '2026-08-13', to: '2026-09-11', sort: 'views', page: 1, size: 10 });
  });

  it('shows the top posts in the order the server sends them', async () => {
    mockApi({ posts: () => ({ total: 2, items: [post('p2', 'World'), post('p1', 'Hello')] }) });
    renderPage();

    await screen.findByText('World');
    // Scoped to the top-posts region: recharts' own <ul>/<li> legend (rendered
    // above, for the trend chart's series) is also a list of listitems.
    const items = within(screen.getByRole('region', { name: 'Топ-10 постов' })).getAllByRole('listitem');
    expect(within(items[0]).getByText('World')).toBeInTheDocument();
    expect(within(items[1]).getByText('Hello')).toBeInTheDocument();
  });

  it('shows totals and averages in Russian', async () => {
    mockApi();
    const { container } = renderPage();

    // Scoped to the stat tiles' <dl>: the sort control also has a "Просмотры" button.
    await waitFor(() => expect(container.querySelector('dl')).toBeInTheDocument());
    const tiles = within(container.querySelector('dl')!);
    expect(tiles.getByText('Просмотры')).toBeInTheDocument();
    expect(tiles.getByText('Средние просмотры')).toBeInTheDocument();
    expect(tiles.getByText(digits('4000'))).toBeInTheDocument();
  });

  it('refetches the summary and the top posts for a chosen preset', async () => {
    mockApi();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Прошлый месяц' }));

    await waitFor(() => expect(lastCallTo('/detail')).toEqual({ from: '2026-08-01', to: '2026-08-31' }));
    expect(lastCallTo('/posts')).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('ranks the top posts by the chosen sort', async () => {
    mockApi();
    renderPage();

    const sortGroup = await screen.findByRole('group', { name: 'Сортировка' });
    fireEvent.click(within(sortGroup).getByRole('button', { name: 'Реакции' }));

    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ sort: 'reactions', page: 1, size: 10 }));
  });

  it('filters by post type on the server, and sends no type for «Все»', async () => {
    mockApi();
    renderPage();

    await screen.findByText('Hello');
    expect(lastCallTo('/posts')).not.toHaveProperty('type');

    fireEvent.change(screen.getByLabelText('Тип поста'), { target: { value: 'video' } });

    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ type: 'video' }));
  });

  it('keeps the full list behind a button that shows the total, and loads it only when opened', async () => {
    mockApi({ posts: () => ({ total: 37, items: [post('p1', 'Hello')] }) });
    renderPage();

    const reveal = await screen.findByRole('button', { name: 'Показать все посты (37)' });
    expect(callsTo('/posts')).toHaveLength(1);
    expect(screen.queryByText('Всего постов: 37')).not.toBeInTheDocument();

    fireEvent.click(reveal);

    expect(await screen.findByText('Всего постов: 37')).toBeInTheDocument();
    expect(callsTo('/posts')).toHaveLength(2);
    expect(reveal).toHaveTextContent('Скрыть список');

    fireEvent.click(reveal);
    expect(screen.queryByText('Всего постов: 37')).not.toBeInTheDocument();
  });

  it('pages through the full list and goes back to page 1 when what it holds changes', async () => {
    mockApi({ posts: () => ({ total: 37, items: [post('p1', 'Hello')] }) });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Показать все посты (37)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Страница 2' }));
    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ page: 2, size: 10 }));

    fireEvent.change(screen.getByLabelText('Показывать'), { target: { value: '25' } });
    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ page: 1, size: 25 }));

    fireEvent.click(screen.getByRole('button', { name: 'Страница 2' }));
    await waitFor(() => expect(lastCallTo('/posts')).toMatchObject({ page: 2, size: 25 }));

    const sortGroup = screen.getByRole('group', { name: 'Сортировка' });
    fireEvent.click(within(sortGroup).getByRole('button', { name: 'ERR' }));

    await waitFor(() => {
      const tableCalls = callsTo('/posts').filter((params) => params.size === 25);
      expect(tableCalls.at(-1)).toMatchObject({ page: 1, sort: 'er' });
    });
  });

  it('explains where the data begins when the period reaches back further', async () => {
    mockApi({ detailData: detail({ postsFrom: '2026-08-20', followersFrom: '2026-09-10' }) });
    renderPage();

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Посты собраны с 20.08.2026, подписчики — с 10.09.2026. Более ранние данные недоступны.',
    );
  });

  it('says nothing about coverage when the period is within the collected data', async () => {
    mockApi({ detailData: detail({ postsFrom: '2026-06-12', followersFrom: '2026-06-12' }) });
    renderPage();

    await screen.findByText('Chan');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says so when the period has no posts, and offers no full list', async () => {
    mockApi({ posts: () => ({ total: 0, items: [] }) });
    renderPage();

    expect(await screen.findByText('Постов за этот период нет.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Показать все посты/ })).not.toBeInTheDocument();
  });

  it('shows an error instead of hanging on the spinner when the account cannot be loaded', async () => {
    get.mockRejectedValue({ response: { status: 500 } });
    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить данные аккаунта'));
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument();
  });

  it('says the account was not found when the server returns a 404', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Аккаунт не найден'));
  });
});
