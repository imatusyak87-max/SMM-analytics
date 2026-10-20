import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectPage } from './ProjectPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const get = apiClient.get as any;
const patch = apiClient.patch as any;
const del = apiClient.delete as any;

const item = (id: string, name: string, platform: string, followers: number) => ({
  account: { id, platform, name, avatarUrl: null, type: 'own' },
  latestSnapshot: { followersCount: followers, avgEr: 1.5 },
});

const twoAccounts = {
  id: 'p1', name: 'Coffee Lab', totalFollowers: 1500,
  accounts: [item('acc-ig', 'coffee_ig', 'instagram', 1000), item('acc-tg', 'Coffee TG', 'telegram', 500)],
};

function mockProfile(data: unknown = twoAccounts) {
  get.mockImplementation((url: string) =>
    url === '/profiles/p1' ? Promise.resolve({ data }) : Promise.resolve({ data: new Blob() }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/projects" element={<p>All projects page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a tile per network in a fixed order, filled or empty', async () => {
    mockProfile();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Coffee Lab' })).toBeInTheDocument();
    expect(screen.getAllByTestId('network-tile').map((t) => t.dataset.platform)).toEqual(['instagram', 'telegram', 'vk', 'youtube']);
    expect(screen.getByText('ВКонтакте — скоро')).toBeInTheDocument();
  });

  it('shows an empty project with add tiles', async () => {
    mockProfile({ id: 'p1', name: 'Мезопроф', totalFollowers: null, accounts: [] });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Добавить Instagram' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить Telegram' })).toBeInTheDocument();
  });

  it('keeps a second account of the same network as an extra tile', async () => {
    mockProfile({ ...twoAccounts, accounts: [...twoAccounts.accounts, item('acc-tg2', 'Second TG', 'telegram', 100)] });
    renderPage();
    expect(await screen.findByText('Second TG')).toBeInTheDocument();
    expect(screen.getAllByTestId('network-tile')).toHaveLength(5);
  });

  it('lists the links that could not be added when it was created', async () => {
    mockProfile();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/p1', state: { failed: [{ platform: 'telegram', message: 'Канал не найден' }] } }]}>
        <Routes><Route path="/projects/:id" element={<ProjectPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось добавить: Telegram — Канал не найден');
  });

  it('shows one line per failed link', async () => {
    mockProfile();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/p1', state: { failed: [
        { platform: 'telegram', message: 'Канал не найден' },
        { platform: 'instagram', message: 'Аккаунт не найден' },
      ] } }]}>
        <Routes><Route path="/projects/:id" element={<ProjectPage />} /></Routes>
      </MemoryRouter>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.querySelectorAll('p')).toHaveLength(2);
    expect(alert).toHaveTextContent('Не удалось добавить: Instagram — Аккаунт не найден');
  });

  it('clears the failure notice after an account is added from a tile', async () => {
    mockProfile({ ...twoAccounts, accounts: [twoAccounts.accounts[0]] });
    (apiClient as any).post = vi.fn().mockResolvedValue({ data: { id: 'a9' } });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/p1', state: { failed: [{ platform: 'telegram', message: 'Канал не найден' }] } }]}>
        <Routes><Route path="/projects/:id" element={<ProjectPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить Telegram' }));
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: 'https://t.me/abcde' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('deletes the project after confirmation and goes to all projects', async () => {
    mockProfile();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    del.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить проект' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/profiles/p1'));
    expect(await screen.findByText('All projects page')).toBeInTheDocument();
  });

  it('renames the project on Enter', async () => {
    mockProfile();
    patch.mockResolvedValue({ data: {} });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название проекта');
    fireEvent.change(input, { target: { value: 'Coffee Lab Moscow' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/profiles/p1', { name: 'Coffee Lab Moscow' }));
  });

  it('cancels a rename on Escape', async () => {
    mockProfile();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название проекта');
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(await screen.findByRole('heading', { name: 'Coffee Lab' })).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows why a rename failed', async () => {
    mockProfile();
    patch.mockRejectedValue({ response: { data: { message: 'Название проекта не может быть пустым' } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название проекта');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Название проекта не может быть пустым');
  });

  it('joins several validation messages into one line', async () => {
    mockProfile();
    patch.mockRejectedValue({ response: { data: { message: ['Первое', 'Второе'] } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название проекта');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Первое, Второе');
  });

  it('caps the name input at 100 characters', async () => {
    mockProfile();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    expect(screen.getByLabelText('Название проекта')).toHaveAttribute('maxlength', '100');
  });

  it('says so when the project does not exist', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText('Проект не найден')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Вернуться ко всем проектам' })).toHaveAttribute('href', '/projects');
  });
});
